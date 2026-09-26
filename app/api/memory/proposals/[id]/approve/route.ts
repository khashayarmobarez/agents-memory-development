import { NextResponse } from "next/server";

import { notFound, unavailable } from "@/lib/http";
import { approveProposal } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Next 15+ made dynamic route params async: `params` is a Promise and must be
// awaited. Reading params.id directly gives you a Promise, not a string.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const result = await approveProposal(id);
    if (result === null) {
      return notFound(`no pending proposal with id ${id}`);
    }
    return NextResponse.json({ approved: true, ...result });
  } catch (error) {
    return unavailable(error);
  }
}
