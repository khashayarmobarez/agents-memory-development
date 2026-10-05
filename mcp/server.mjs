#!/usr/bin/env node
/**
 * MCP server exposing the memory system as agent tools.
 *
 * It talks HTTP to the Next.js API rather than to Neo4j directly, so the approval
 * gate stays in exactly one place. If this process could create Decision nodes,
 * there would be two ways into the graph and the invariant would stop being one.
 *
 * Auth: the machine presents MEMORY_API_KEY (or ~/.memory-api-key) as a Bearer
 * token. The key may propose and read — it can never approve, reject or delete.
 *
 * stdout is the JSON-RPC channel. Never console.log here — a stray line corrupts
 * the protocol. Diagnostics go to stderr.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const log = (...args) => console.error("[memory-mcp]", ...args);

// Env first, files second — the file fallbacks keep every MCP client working
// without threading env vars through each client's config.
function fileValue(name) {
  try {
    return readFileSync(join(homedir(), name), "utf8").trim();
  } catch {
    return null;
  }
}

const API =
  process.env.MEMORY_API ?? fileValue(".memory-api-url") ?? "http://localhost:3000/api";
const KEY = process.env.MEMORY_API_KEY ?? fileValue(".memory-api-key");

async function callApi(path, init) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    // A bare "fetch failed" tells an agent nothing. Name the actual problem and
    // the fix, because the agent reading this is the one that has to act on it.
    throw new Error(
      `memory API unreachable at ${API}. Start it with: ` +
        `cd ~/projects/memory-system/web && pnpm dev ` +
        `(then confirm with: curl ${API}/health). Underlying error: ${cause.message}`,
    );
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const hint =
      response.status === 401
        ? " The machine key is missing or wrong — set MEMORY_API_KEY (or write it to ~/.memory-api-key)."
        : "";
    throw new Error(
      `memory API responded ${response.status}: ${body.error ?? response.statusText}.${hint}`,
    );
  }
  return body;
}

const asText = (value) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const server = new McpServer({ name: "memory-system", version: "0.1.0" });

server.registerTool(
  "search",
  {
    title: "Search project memory",
    description:
      "Search APPROVED project memory. Returns only knowledge a human approved. " +
      "Call this before asking the user about past decisions.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe("Free-text match against decision titles and content"),
      projectId: z.string().optional().describe("Restrict to one project"),
    },
  },
  async ({ query, projectId }) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (projectId) params.set("projectId", projectId);
    return asText(await callApi(`/memory/search?${params.toString()}`));
  },
);

server.registerTool(
  "propose",
  {
    title: "Propose a memory",
    description:
      "Propose a memory for a human to approve. This does NOT store knowledge — it " +
      "queues a pending proposal that stays invisible to search until approved. " +
      "After calling this, tell the user the proposal is waiting for their approval.",
    inputSchema: {
      type: z.enum(["decision", "convention", "note"]),
      title: z.string().describe("Short imperative summary"),
      content: z.string().describe("The memory itself, stated in full"),
      projectId: z.string(),
      sourceReference: z
        .string()
        .optional()
        .describe("Where this came from — a file, a conversation, a commit"),
    },
  },
  async ({ type, title, content, projectId, sourceReference }) => {
    const body = await callApi("/memory/proposals", {
      method: "POST",
      body: JSON.stringify({
        type,
        title,
        content,
        projectId,
        source: {
          type: "agent",
          reference: sourceReference ?? "agent session",
        },
      }),
    });

    return asText(
      "Proposal queued, pending human approval. It is NOT retrievable until approved.\n\n" +
        JSON.stringify(body.proposal, null, 2),
    );
  },
);

server.registerTool(
  "proposeDeletion",
  {
    title: "Propose deleting a memory",
    description:
      "Request deletion of an approved memory (a Decision). This deletes nothing — " +
      "it queues a deletion request that a human approves or rejects. Get the " +
      "targetId from a search result first. After calling this, tell the user the " +
      "request is waiting on the approval desk.",
    inputSchema: {
      targetId: z.string().describe("Decision id from search results"),
      reason: z.string().describe("Why this memory should be deleted"),
      title: z
        .string()
        .optional()
        .describe("The target memory's title, so the human sees what is at stake"),
      projectId: z.string(),
    },
  },
  async ({ targetId, reason, title, projectId }) => {
    const body = await callApi("/memory/proposals", {
      method: "POST",
      body: JSON.stringify({
        type: "deletion",
        title: `Delete memory: ${title ?? targetId}`,
        content: reason,
        targetId,
        projectId,
        source: { type: "agent", reference: "deletion request" },
      }),
    });

    return asText(
      "Deletion request queued, pending human approval. Nothing is deleted until " +
        "a human approves it.\n\n" +
        JSON.stringify(body.proposal, null, 2),
    );
  },
);

server.registerTool(
  "getProjectContext",
  {
    title: "Get project context",
    description:
      "Load everything approved about a project, grouped by type. Call this once at " +
      "the start of a session to recover what was decided before.",
    inputSchema: { projectId: z.string() },
  },
  async ({ projectId }) =>
    asText(await callApi(`/memory/projects/${encodeURIComponent(projectId)}/context`)),
);

await server.connect(new StdioServerTransport());
log(`connected; API at ${API}, machine key ${KEY ? "set" : "MISSING"}`);
