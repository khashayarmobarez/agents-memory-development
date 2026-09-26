export type MemoryType = "decision" | "convention" | "note";
export type ProposalStatus = "pending" | "approved" | "rejected";

export interface MemorySource {
  type: string;
  reference: string;
}

export interface ProposalInput {
  type: MemoryType;
  title: string;
  content: string;
  projectId: string;
  workspaceId: string;
  source: MemorySource;
}

export interface Proposal {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  projectId: string;
  workspaceId: string;
  sourceType: string;
  sourceReference: string;
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
  decisionId: string;
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
