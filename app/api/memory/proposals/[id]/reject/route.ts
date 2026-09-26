import { NextResponse } from "next/server";

import { notFound, unavailable } from "@/lib/http";
import { rejectProposal } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const rejected = await rejectProposal(id);
    if (!rejected) {
      return notFound(`no pending proposal with id ${id}`);
    }
    return NextResponse.json({ rejected: true, proposalId: id });
  } catch (error) {
    return unavailable(error);
  }
}
