import { NextResponse } from "next/server";

import { badRequest, unavailable } from "@/lib/http";
import { createProposal, listProposals } from "@/lib/memory";
import type { ProposalInput, ProposalStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES: ProposalStatus[] = ["pending", "approved", "rejected"];

type Parsed =
  | { ok: true; value: ProposalInput }
  | { ok: false; errors: string[] };

function parseProposal(body: unknown): Parsed {
  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  const requireString = (key: string): string => {
    const value = b[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    errors.push(`${key} is required and must be a non-empty string`);
    return "";
  };

  const type = requireString("type");
  const title = requireString("title");
  const content = requireString("content");
  const projectId = requireString("projectId");

  const workspaceId =
    typeof b.workspaceId === "string" && b.workspaceId.trim() !== ""
      ? b.workspaceId.trim()
      : "personal";

  let sourceType = "manual";
  let sourceReference = "unspecified";

  if (typeof b.source === "object" && b.source !== null) {
    const source = b.source as Record<string, unknown>;
    if (typeof source.type === "string" && source.type.trim() !== "") {
      sourceType = source.type.trim();
    }
    if (typeof source.reference === "string" && source.reference.trim() !== "") {
      sourceReference = source.reference.trim();
    }
  } else {
    errors.push("source must be an object with type and reference");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      type: type as ProposalInput["type"],
      title,
      content,
      projectId,
      workspaceId,
      source: { type: sourceType, reference: sourceReference },
    },
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("body must be valid JSON");
  }

  const parsed = parseProposal(body);
  if (!parsed.ok) return badRequest("validation failed", parsed.errors);

  try {
    const proposal = await createProposal(parsed.value);
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error) {
    return unavailable(error);
  }
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("status") ?? "pending";

  if (!STATUSES.includes(requested as ProposalStatus)) {
    return badRequest(`status must be one of: ${STATUSES.join(", ")}`);
  }

  try {
    const proposals = await listProposals(requested as ProposalStatus);
    return NextResponse.json({ proposals, count: proposals.length });
  } catch (error) {
    return unavailable(error);
  }
}
