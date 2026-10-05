export type MemoryType = "decision" | "convention" | "note";
export type ProposalType = MemoryType | "deletion";
export type ProposalStatus = "pending" | "approved" | "rejected";

export interface MemorySource {
  type: string;
  reference: string;
}

export interface ProposalInput {
  type: ProposalType;
  title: string;
  content: string;
  projectId: string;
  workspaceId: string;
  /** The Decision a deletion proposal targets; null for memory proposals. */
  targetId: string | null;
  source: MemorySource;
}

export interface Proposal {
  id: string;
  type: ProposalType;
  title: string;
  content: string;
  projectId: string;
  workspaceId: string;
  sourceType: string;
  sourceReference: string;
  targetId: string | null;
  /** Snapshot of the target's title, taken when a deletion is approved. */
  targetTitle: string | null;
  status: ProposalStatus;
  createdAt: string;
}

export interface Memory {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  projectId: string;
  approvedAt: string;
}

export interface ApprovalResult {
  proposalId: string;
  /** null when the approval was a deletion — there is no new Decision. */
  decisionId: string | null;
  projectId: string;
}

export interface ContextSource {
  type: string;
  reference: string;
}

export interface ContextDecision {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  approvedAt: string;
  sources: ContextSource[];
}

export interface ProjectContext {
  projectId: string;
  workspaceId: string | null;
  decisionCount: number;
  decisionsByType: Record<string, ContextDecision[]>;
}
