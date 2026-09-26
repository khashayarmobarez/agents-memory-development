#!/usr/bin/env node
/**
 * MCP server exposing the memory system as three agent tools.
 *
 * It talks HTTP to the Next.js API rather than to Neo4j directly, so the approval
 * gate stays in exactly one place. If this process could create Decision nodes,
 * there would be two ways into the graph and the invariant would stop being one.
 *
 * stdout is the JSON-RPC channel. Never console.log here — a stray line corrupts
 * the protocol. Diagnostics go to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = process.env.MEMORY_API ?? "http://localhost:3000/api";
const log = (...args) => console.error("[memory-mcp]", ...args);

async function callApi(path, init) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `memory API responded ${response.status}: ${body.error ?? response.statusText}`,
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
log(`connected; API at ${API}`);
