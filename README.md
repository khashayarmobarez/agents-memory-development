# Memory System — web

A memory layer for AI agents: agents **propose** memories, a human **approves** them,
and only approved knowledge becomes queryable. Built on Next.js and Neo4j.

The point is not storage. The point is that an agent's confident guess never becomes
established fact without a human saying so.

```
Agent proposes memory
        ↓
    Proposal (pending)          ← staging, invisible to search
        ↓
   YOU APPROVE / REJECT
        ↓
   Decision + Source            ← permanent, linked into the graph
        ↓
     searchable memory
```

## Stack

| Component      | Version   | Notes                                  |
| -------------- | --------- | -------------------------------------- |
| Next.js        | 16.3.6    | App Router, Turbopack                  |
| React          | 19.2.8    |                                        |
| TypeScript     | 5.9.x     | `strict`                               |
| Tailwind CSS   | 4.3.x     |                                        |
| neo4j-driver   | 6.2.0     |                                        |
| Neo4j          | 2026.08.1 | via `../infrastructure/docker-compose.yml` |
| Node           | 24.x LTS  |                                        |

## Getting started

Neo4j must be running first:

```bash
cd ../infrastructure && docker compose up -d
```

Then create `web/.env.local`:

```env
NEO4J_URI=neo4j://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<the password in ../infrastructure/docker-compose.yml>
NEO4J_DATABASE=neo4j

# auth — see the Auth section
APP_PASSWORD=<the human password>
APP_SECRET=<openssl rand -hex 32>
MEMORY_API_KEY=<openssl rand -hex 32>
```

Then:

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

`.env.local` is gitignored. `.env*` files are never written by tooling — create it by hand.

## Aura + weekly mirror

The real record lives in **Neo4j AuraDB Free** (source of truth). The local Docker
Neo4j is kept as a weekly mirror and archive target.

Two untracked env files hold the credentials (create by hand):

- `.env.aura` — `AURA_URI`, `AURA_USERNAME`, `AURA_PASSWORD`, `AURA_DATABASE`, plus
  `BACKUP_DIR` (archive folder) and `KEEP` (how many archives to retain).
- `.env.localdb` — `LOCAL_*` for the local Docker Neo4j mirror.

`scripts/sync-memory.mjs` moves the graph between them:

```bash
node --env-file=.env.aura --env-file=.env.localdb scripts/sync-memory.mjs push    # local -> Aura
node --env-file=.env.aura --env-file=.env.localdb scripts/sync-memory.mjs pull    # Aura -> archive -> local mirror
node --env-file=.env.aura --env-file=.env.localdb scripts/sync-memory.mjs restore <file.json>
node --env-file=.env.aura scripts/sync-memory.mjs ping                             # keeps a Free instance awake
```

`pull` writes a timestamped JSON archive first (oldest pruned beyond `KEEP`), then
replaces the local graph inside one transaction; it refuses to mirror an empty Aura
graph, so a remote mistake can never wipe the mirror silently.

On this machine two Windows scheduled tasks run the wrappers in the backup folder:
**Memory weekly Aura backup** (Sundays 03:00, `backup-weekly.cmd`, start-when-available)
and **Memory Aura keepalive** (daily, `keepalive.cmd`) — Free instances auto-pause
after ~3 quiet days. Once the Vercel deployment exists, a daily cron hitting
`/api/health` can replace the keepalive task.

To run the local app against Aura, copy the Aura values into `NEO4J_*` in
`.env.local` and restart `pnpm dev`.

## API

| Method | Path                                    | Purpose                          |
| ------ | --------------------------------------- | -------------------------------- |
| GET    | `/api/health`                           | `RETURN 1` — proves DB connectivity (public) |
| POST   | `/api/auth/login`                       | Password → session cookie        |
| POST   | `/api/auth/logout`                      | Clear the session cookie         |
| POST   | `/api/memory/proposals`                 | Create a proposal (pending)      |
| GET    | `/api/memory/proposals?status=pending`  | List proposals by status         |
| POST   | `/api/memory/proposals/:id/approve`     | Promote to permanent memory      |
| POST   | `/api/memory/proposals/:id/reject`      | Discard                          |
| POST   | `/api/memory/proposals/:id/delete`      | Hard-delete a decided proposal, with its Decision and Source if approved |
| GET    | `/api/memory/search?q=&projectId=`      | Query **approved** memory only   |
| GET    | `/api/memory/projects/:id/context`      | Everything approved about a project, grouped by type |

Everything except `/api/health` and `/api/auth/*` requires auth: the human session
cookie (from `/login`) or, for the agent endpoints, `Authorization: Bearer $MEMORY_API_KEY`.
The key may file proposals (including deletion requests) and read — approve, reject
and delete take the session only, so an agent can never decide.

Create a proposal:

```bash
curl -X POST http://localhost:3000/api/memory/proposals \
  -H "Content-Type: application/json" \
  -d '{
    "type": "decision",
    "title": "Use Next.js App Router",
    "content": "The memory system will use the Next.js App Router.",
    "projectId": "memory-system",
    "source": { "type": "manual", "reference": "initial architecture discussion" }
  }'
```

Approve it, then confirm it appears in `/api/memory/search`. Before approval it must not.

## Reviewing proposals

Humans approve at **http://localhost:3000/memory** — a queue of everything pending, each
card showing the title, the full content, and which files or conversation it came from.
Approve promotes it to a Decision; Reject discards it. Neither is undoable from the page.

Two files: `page.tsx` reads the queue server-side, straight to the same domain functions
the API routes call — a read protects no invariant, so a self-HTTP hop would buy nothing.
`proposal-queue.tsx` does the writes by `POST`ing to the same API routes agents use:
the approval path keeps exactly one entry point, and approving it requires nothing more
than the human session every page of this app already carries.

The desk is tabbed (`/memory?tab=pending|approved|rejected`) and has a disposal room at
**http://localhost:3000/memory/manage**: search the decided records, select, and delete
for good. Deletion is a hard delete — the Proposal goes, and with an approved one its
Decision and Source go too, in one transaction. Pending proposals cannot be deleted;
approve or reject them first.

Agents can also file **deletion requests** (`type: "deletion"`, via the `proposeDeletion`
MCP tool): they sit in the queue like any proposal, showing the Decision they target;
approving one takes the target — Decision, Source and the original Proposal — off the
record in a single transaction.

With no browser to hand, the same thing over `curl` — log in once, keep the jar:

```bash
curl -s -c jar -X POST "http://localhost:3000/api/auth/login" \
  -H "content-type: application/json" -d '{"password":"<APP_PASSWORD>"}'
curl -s -b jar "http://localhost:3000/api/memory/proposals?status=pending"
curl -s -b jar -X POST "http://localhost:3000/api/memory/proposals/<id>/approve"
curl -s -b jar -X POST "http://localhost:3000/api/memory/proposals/<id>/reject"
curl -s -b jar -X POST "http://localhost:3000/api/memory/proposals/<id>/delete"
```

**Never approve by editing the graph in the Neo4j Browser.** Approval is one atomic
statement that creates the `Decision`, its `Source`, and the `HAS_DECISION` edge together.
Done by hand you get a Decision that search can never reach — and if you delete the
Decision afterwards, an orphaned `Source` that nothing points to.

## Data model

```
Workspace ──CONTAINS──> Project ──HAS_DECISION──> Decision ──SUPPORTED_BY──> Source

Proposal                          (staging; status = pending | approved | rejected)
```

`Decision` nodes are created **only** by the approve endpoint. That is what makes
unapproved memory unreachable from search — not a filter, the shape of the graph.

Uniqueness constraints exist on `id` for `Workspace`, `Project`, `Decision`, `Source`.

## Layout

```
lib/
  neo4j.ts      driver singleton, session helper, query helper
  memory.ts     domain operations (propose, approve, reject, search)
  types.ts      domain shapes
  http.ts       error → HTTP response mapping
app/
  memory/page.tsx                 the approval desk, status tabs (server component)
  memory/proposal-queue.tsx       approve / reject buttons (client component)
  memory/decided-list.tsx         read-only approved / rejected cards
  memory/presentation.ts          shared type-chip, stamp-mark and date helpers
  memory/manage/page.tsx          the disposal room (server component)
  memory/manage/manage-list.tsx   search, select, delete (client component)
  api/health/route.ts
  api/memory/proposals/route.ts
  api/memory/proposals/[id]/approve/route.ts
  api/memory/proposals/[id]/reject/route.ts
  api/memory/search/route.ts
docs/
  how-memory-works.md              the concepts
  how-the-implementation-works.md  the code
mcp/
  server.mjs    exposes search / propose / getProjectContext to agents
scripts/
  sync-memory.mjs  Aura <-> local mirror: push / pull / restore / ping
```

## Agent tools (MCP)

`mcp/server.mjs` is a stdio MCP server exposing three tools to any MCP-capable
agent (Hermes, OpenCode, Claude Code):

| Tool                | Wraps                                    |
| ------------------- | ---------------------------------------- |
| `search`            | `GET /api/memory/search`                 |
| `propose`           | `POST /api/memory/proposals`             |
| `getProjectContext` | `GET /api/memory/projects/:id/context`   |

It calls the HTTP API instead of Neo4j directly, deliberately: if this process
could create `Decision` nodes, there would be two routes into the graph and the
approval invariant would stop being one thing.

With auth enabled, the server sends `Authorization: Bearer` from `MEMORY_API_KEY`
(or the file `~/.memory-api-key` when the env var is unset); `MEMORY_API` — or the
file `~/.memory-api-url` — can point at the deployment
(`https://<app>.vercel.app/api`), so agents keep working even when the local dev
server is off.

Registered with Hermes as:

```bash
hermes mcp add memory --command wsl.exe \\
  --args -e /root/.nvm/versions/node/v24.21.0/bin/node \\
  /root/projects/memory-system/web/mcp/server.mjs
```

It requires the app to be running, and it needs a **new Hermes session** before
the tools appear (they show up as `mcp_memory_search`, `mcp_memory_propose`,
`mcp_memory_getProjectContext`).

## Deploying to Vercel

1. Import the repo in Vercel (root = repo root); set for Production and Preview:
   the four `NEO4J_*` Aura values plus `APP_PASSWORD`, `APP_SECRET`, `MEMORY_API_KEY`.
2. `vercel.json` schedules a daily `GET /api/health` cron — it keeps the AuraDB Free
   instance from auto-pausing, and can replace the local keepalive task once the
   deployment is live.
3. Pick the region closest to you; every query round-trips to Aura.
4. Point agents at it: `MEMORY_API=https://<app>.vercel.app/api` in the MCP config.

## Notes

`AGENTS.md` and `CLAUDE.md` are generated and re-added by `next dev`. Don't hand-edit
them; the change gets recreated.

## Known limitations

- **Single shared password, no MFA.** Sessions are stateless HMAC cookies; the only
  revocation is rotating `APP_SECRET`, which logs everyone out at once. Login has a
  failure delay, not a real rate limiter.
- **Concurrent approval is not defence-in-depth.** Sequential double-approval is a
  clean 404; two truly simultaneous approvals could both create a Decision, because
  read-committed isolation doesn't re-evaluate `WHERE status = 'pending'` after a lock
  wait. Fix with a uniqueness constraint or an explicit node lock if it matters.
- **Search uses `CONTAINS`**, a full label scan. Fine at hundreds of Decisions, wrong at
  tens of thousands — that's when a full-text index replaces it.
- **`error.message` is returned to clients.** Information disclosure in production.
- **No deduplication.** The same proposal can be created repeatedly; duplicates are pruned
  by hand from the disposal room. Deletion is permanent — no undo, no audit trail.
- **`getProjectContext` starts with two queries, not one.** Fine per session, and
  it would be one query if a nested `collect` were worth the unreadability.
