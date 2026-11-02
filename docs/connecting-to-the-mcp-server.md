# Connecting to the memory MCP server

The memory app is deployed at `https://agents-memory.vercel.app`. Agents reach it
through MCP, in one of two ways:

| Client                              | Transport            | Auth                  | Section |
| ----------------------------------- | -------------------- | --------------------- | ------- |
| claude.ai (web, mobile, desktop)    | remote, `/api/mcp`   | OAuth (you log in)    | [1](#1-claudeai-custom-connector) |
| Claude Code, opencode, Hermes, etc. | local stdio shim     | machine key           | [2](#2-local-agents-stdio-shim) |

Either way the agent can **read approved memory and file proposals**. It can never
approve, reject or delete — that stays with you at `/memory`.

- API: `https://agents-memory.vercel.app/api`
- Health: `https://agents-memory.vercel.app/api/health` → `{"ok":true}`
- Approval desk: `https://agents-memory.vercel.app/login`, then `/memory`

## The tools

| Tool                | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `search`            | Search approved memory (`query`, optional `projectId`)              |
| `getProjectContext` | Everything approved about one project, grouped by type              |
| `propose`           | File a decision / convention / note — waits for your approval       |
| `proposeDeletion`   | Ask to delete an approved memory — waits for your approval          |

Pending proposals are invisible to `search` until you approve them. Search is a
verbatim, case-insensitive match on title and content, so an empty result does not
prove a memory is absent.

## 1. claude.ai custom connector

claude.ai only accepts a remote MCP URL, so it uses `/api/mcp` with OAuth 2.1
(PKCE and dynamic client registration — nothing to configure by hand).

1. Open **claude.ai → Customize → Connectors → Add custom connector**.
2. Name: `memory`. URL:

   ```
   https://agents-memory.vercel.app/api/mcp
   ```

3. Continue. claude.ai opens the app's login page — enter the desk password.
4. On the **Connector request** screen, check that the destination is `claude.ai`,
   then click **Allow access**. (If it shows any other host, click **Deny**.)
5. In a chat, enable the connector from the tools menu and ask it to search your
   memory.

Access tokens last 1 hour and refresh automatically; the connection itself lasts 30
days before you are asked to log in again.

**Revoking access.** Remove the connector in claude.ai to stop using it. To cut off
*every* connector and session at once, rotate `APP_SECRET` in Vercel and redeploy —
tokens are signed with it and nothing is stored server-side.

## 2. Local agents (stdio shim)

Claude Code, opencode and Hermes launch `mcp/server.mjs` as a local process. It
talks to the deployed API with a machine key.

### Install the shim

Inside a clone of this repo the dependencies are already installed, so point
straight at `mcp/server.mjs`. On a machine without the repo:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.memory-mcp" | Out-Null
# copy mcp/server.mjs into %USERPROFILE%\.memory-mcp\
cd "$env:USERPROFILE\.memory-mcp"
npm init -y
npm i @modelcontextprotocol/sdk@^1.30.1 zod@^4.6.5
```

### Point it at the deployment

The shim reads, in order:

- `MEMORY_API` env var → `~/.memory-api-url` → `http://localhost:3000/api`
- `MEMORY_API_KEY` env var → `~/.memory-api-key`

```powershell
Set-Content "$env:USERPROFILE\.memory-api-url" "https://agents-memory.vercel.app/api"
Set-Content "$env:USERPROFILE\.memory-api-key" "<machine key>"
```

The machine key is the `MEMORY_API_KEY` value from the Vercel project's environment
variables. Never copy `.env.local`, `.env.aura` or the Neo4j credentials to another
machine — the key can only read and propose.

### Register it

**Claude Code**

```powershell
claude mcp add --scope user memory -- node "C:\path\to\mcp\server.mjs"
claude mcp list        # memory should show Connected
```

Tools appear as `mcp__memory__search`, `mcp__memory__propose`,
`mcp__memory__proposeDeletion`, `mcp__memory__getProjectContext`.

**opencode** — edit `C:\Users\<you>\.config\opencode\opencode.jsonc`:

```jsonc
{
  "mcp": {
    "servers": {
      "memory": {
        "type": "local",
        "command": ["node", "C:\\path\\to\\mcp\\server.mjs"],
        "disabled": false
      }
    }
  }
}
```

**Hermes**

```powershell
hermes mcp add memory --command node --args "C:\path\to\mcp\server.mjs"
```

MCP servers load at startup — **start a new session** after any config change.

## 3. Verify

Health, then an authenticated search with the machine key:

```powershell
Invoke-RestMethod "https://agents-memory.vercel.app/api/health"

$k = (Get-Content "$env:USERPROFILE\.memory-api-key" -Raw).Trim()
Invoke-RestMethod "https://agents-memory.vercel.app/api/memory/search?q=Next.js" `
  -Headers @{ Authorization = "Bearer $k" }
```

Then, in an agent session, call `getProjectContext` with a known `projectId` (for
example `memory-system`) and confirm it returns approved records.

## 4. Tell each repo its project

There is no automatic folder → `projectId` mapping. Add this to each repository's
`AGENTS.md` / `CLAUDE.md`:

```md
At session start call memory_getProjectContext with projectId=<id>.
File proposals with the same projectId.
```

Tool names are prefixed by the client (`mcp__memory__…` in Claude Code,
`memory_…` in opencode/Hermes). Existing ids: `memory-system`, `passkadeh`,
`khashayar`, `rahyab-vision`.

## Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| Tools missing in the agent | Start a new session; check `claude mcp list` |
| Shim says `memory API unreachable` | Wrong `~/.memory-api-url`, or you are offline; check `/api/health` |
| Shim says `401` | `~/.memory-api-key` missing or wrong; `MEMORY_API_KEY` in Vercel must match |
| claude.ai connector can't connect | Open `/.well-known/oauth-authorization-server` in a browser — it must return JSON. If the URLs inside show the wrong host, set `PUBLIC_URL=https://agents-memory.vercel.app` in Vercel |
| Connector asks to log in again | Normal after 30 days, or after `APP_SECRET` was rotated |
| Consent screen says "Cannot authorize" | The request's `redirect_uri` doesn't match the client's registration — remove and re-add the connector |
| `search` returns nothing | Search is literal substring; the memory may also still be pending at `/memory` |
| Server crashes writing to stdout | `mcp/server.mjs` must never `console.log` — stdout is the protocol; diagnostics go to stderr |

## How it works

- `mcp/server.mjs` — stdio shim; calls the HTTP API with the machine key.
- `app/api/mcp/route.ts` + `lib/mcp-tools.ts` — remote server, same four tools, runs
  inside the app and calls `lib/memory.ts` directly. Keep the two tool lists in step.
- `lib/oauth.ts`, `app/api/oauth/*`, `app/oauth/authorize`, `app/.well-known/*` — the
  OAuth server. See "Remote MCP for claude.ai (OAuth)" in the [README](../README.md).
