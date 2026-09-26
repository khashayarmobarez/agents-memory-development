import { randomUUID } from "node:crypto";

import { query, withSession } from "@/lib/neo4j";
import type {
  ApprovalResult,
  ContextDecision,
  ContextSource,
  Memory,
  ProjectContext,
  Proposal,
  ProposalInput,
  ProposalStatus,
} from "@/lib/types";

const now = () => new Date().toISOString();

// Aliased to match the Proposal/Memory interfaces exactly, so toObject() below
// produces the interface with no per-field mapping to keep in sync.
const PROPOSAL_RETURN = `
  p.id AS id,
  p.type AS type,
  p.title AS title,
  p.content AS content,
  p.projectId AS projectId,
  p.workspaceId AS workspaceId,
  p.sourceType AS sourceType,
  p.sourceReference AS sourceReference,
  p.status AS status,
  toString(p.createdAt) AS createdAt
`;

export async function createProposal(input: ProposalInput): Promise<Proposal> {
  const id = randomUUID();
  const createdAt = now();

  await query(
    `CREATE (p:Proposal {
       id: $id,
       type: $type,
       title: $title,
       content: $content,
       projectId: $projectId,
       workspaceId: $workspaceId,
       sourceType: $sourceType,
       sourceReference: $sourceReference,
       status: 'pending',
       createdAt: datetime($createdAt)
     })`,
    {
      id,
      type: input.type,
      title: input.title,
      content: input.content,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      sourceType: input.source.type,
      sourceReference: input.source.reference,
      createdAt,
    },
  );

  return {
    id,
    type: input.type,
    title: input.title,
    content: input.content,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    sourceType: input.source.type,
    sourceReference: input.source.reference,
    status: "pending",
    createdAt,
  };
}

export async function listProposals(
  status: ProposalStatus = "pending",
): Promise<Proposal[]> {
  return query<Proposal>(
    `MATCH (p:Proposal {status: $status})
     RETURN ${PROPOSAL_RETURN}
     ORDER BY p.createdAt DESC`,
    { status },
    (record) => record.toObject() as Proposal,
  );
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const rows = await query<Proposal>(
    `MATCH (p:Proposal {id: $id}) RETURN ${PROPOSAL_RETURN}`,
    { id },
    (record) => record.toObject() as Proposal,
  );
  return rows[0] ?? null;
}

/**
 * Promotion is one statement, so it is atomic without manual transaction
 * handling: either the Decision
 * is created and linked and the proposal flips to approved, or nothing happens.
 * The WHERE on status makes approval idempotent — a second call matches nothing.
 */
export async function approveProposal(id: string): Promise<ApprovalResult | null> {
  const decisionId = randomUUID();
  const sourceId = randomUUID();
  const approvedAt = now();

  return withSession(async (session) =>
    session.executeWrite(async (tx) => {
      const result = await tx.run(
        `MATCH (p:Proposal {id: $id})
         WHERE p.status = 'pending'
         MERGE (workspace:Workspace {id: p.workspaceId})
         MERGE (project:Project {id: p.projectId})
         MERGE (workspace)-[:CONTAINS]->(project)
         CREATE (decision:Decision {
           id: $decisionId,
           type: p.type,
           title: p.title,
           content: p.content,
           approvedAt: datetime($approvedAt)
         })
         CREATE (decision)-[:SUPPORTED_BY]->(source:Source {
           id: $sourceId,
           type: p.sourceType,
           reference: p.sourceReference
         })
         CREATE (project)-[:HAS_DECISION]->(decision)
         SET p.status = 'approved',
             p.approvedAt = datetime($approvedAt),
             p.decisionId = $decisionId
         RETURN p.id AS proposalId,
                decision.id AS decisionId,
                project.id AS projectId`,
        { id, decisionId, sourceId, approvedAt },
      );

      if (result.records.length === 0) return null;

      const record = result.records[0];
      return {
        proposalId: record.get("proposalId") as string,
        decisionId: record.get("decisionId") as string,
        projectId: record.get("projectId") as string,
      };
    }),
  );
}

export async function rejectProposal(id: string): Promise<boolean> {
  const rejectedAt = now();
  const rows = await query<{ id: string }>(
    `MATCH (p:Proposal {id: $id})
     WHERE p.status = 'pending'
     SET p.status = 'rejected', p.rejectedAt = datetime($rejectedAt)
     RETURN p.id AS id`,
    { id, rejectedAt },
    (record) => ({ id: record.get("id") as string }),
  );
  return rows.length > 0;
}

export interface SearchOptions {
  q?: string;
  projectId?: string;
}

/** Only approved knowledge is reachable here — Decisions exist only post-approval. */
export async function searchMemory(options: SearchOptions = {}): Promise<Memory[]> {
  return query<Memory>(
    `MATCH (project:Project)-[:HAS_DECISION]->(decision:Decision)
     WHERE ($projectId IS NULL OR project.id = $projectId)
       AND ($q IS NULL
            OR toLower(decision.title) CONTAINS toLower($q)
            OR toLower(decision.content) CONTAINS toLower($q))
     RETURN decision.id AS id,
            decision.type AS type,
            decision.title AS title,
            decision.content AS content,
            project.id AS projectId,
            toString(decision.approvedAt) AS approvedAt
     ORDER BY decision.approvedAt DESC`,
    { q: options.q ?? null, projectId: options.projectId ?? null },
    (record) => record.toObject() as Memory,
  );
}

/**
 * The third agent tool: everything approved about one project, grouped by type.
 *
 * Two queries in one session on purpose — assembling it in Cypher would mean a
 * nested collect over a two-hop OPTIONAL MATCH, which is unreadable and hard to
 * change. A session is a unit of work, so both queries share one connection.
 */
export async function getProjectContext(
  projectId: string,
): Promise<ProjectContext | null> {
  return withSession(async (session) => {
    const projectResult = await session.run(
      `MATCH (project:Project {id: $projectId})
       OPTIONAL MATCH (workspace:Workspace)-[:CONTAINS]->(project)
       RETURN project.id AS projectId, workspace.id AS workspaceId`,
      { projectId },
    );

    if (projectResult.records.length === 0) return null;

    const record = projectResult.records[0];
    const workspaceId = record.get("workspaceId") as string | null;

    const context: ProjectContext = {
      projectId: record.get("projectId") as string,
      workspaceId: workspaceId ?? null,
      decisionCount: 0,
      decisionsByType: {},
    };

    const decisions = await session.run(
      `MATCH (project:Project {id: $projectId})-[:HAS_DECISION]->(decision:Decision)
       OPTIONAL MATCH (decision)-[:SUPPORTED_BY]->(source:Source)
       RETURN decision.id AS id,
              decision.type AS type,
              decision.title AS title,
              decision.content AS content,
              toString(decision.approvedAt) AS approvedAt,
              collect(DISTINCT { type: source.type, reference: source.reference }) AS sources
       ORDER BY approvedAt DESC`,
      { projectId },
    );

    for (const row of decisions.records) {
      const type = row.get("type") as string;

      // OPTIONAL MATCH with no source yields a map of nulls; drop those.
      const sources = (row.get("sources") as ContextSource[]).filter(
        (source) => source && source.type !== null && source.reference !== null,
      );

      (context.decisionsByType[type] ??= []).push({
        id: row.get("id") as string,
        type: type as ContextDecision["type"],
        title: row.get("title") as string,
        content: row.get("content") as string,
        approvedAt: row.get("approvedAt") as string,
        sources,
      });

      context.decisionCount += 1;
    }

    return context;
  });
}
