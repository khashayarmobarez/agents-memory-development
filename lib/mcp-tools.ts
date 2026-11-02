import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createProposal, getProjectContext, searchMemory } from "@/lib/memory";

const asText = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

/**
 * The remote twin of mcp/server.mjs. The stdio shim goes through the HTTP API;
 * this one runs inside it, so it calls the same lib/memory functions directly.
 * Both expose exactly the machine-key surface: read, and file proposals —
 * never approve, reject or delete. Keep the two tool lists in step.
 */
export function createMemoryMcpServer(): McpServer {
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
      const memory = await searchMemory({
        q: query?.trim() || undefined,
        projectId: projectId?.trim() || undefined,
      });
      return asText({ memory, count: memory.length });
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
        type: z
          .enum(["decision", "convention", "note"])
          .describe(
            "decision = a choice made once whose reasoning must survive (the " +
              "alternatives were real); convention = a standing rule that binds " +
              "every future change in this project; note = descriptive context " +
              "with no binding force, expected to go stale. The type only groups " +
              "context and styles the chip — all three are stored and gated " +
              "identically.",
          ),
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
      const proposal = await createProposal({
        type,
        title: title.trim(),
        content: content.trim(),
        projectId: projectId.trim(),
        workspaceId: "personal",
        targetId: null,
        source: { type: "agent", reference: sourceReference ?? "agent session" },
      });
      return asText(
        "Proposal queued, pending human approval. It is NOT retrievable until approved.\n\n" +
          JSON.stringify(proposal, null, 2),
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
      const proposal = await createProposal({
        type: "deletion",
        title: `Delete memory: ${title ?? targetId}`,
        content: reason.trim(),
        projectId: projectId.trim(),
        workspaceId: "personal",
        targetId,
        source: { type: "agent", reference: "deletion request" },
      });
      return asText(
        "Deletion request queued, pending human approval. Nothing is deleted until " +
          "a human approves it.\n\n" +
          JSON.stringify(proposal, null, 2),
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
    async ({ projectId }) => {
      const context = await getProjectContext(projectId);
      if (context === null) {
        return { ...asText(`no project with id ${projectId}`), isError: true };
      }
      return asText(context);
    },
  );

  return server;
}
