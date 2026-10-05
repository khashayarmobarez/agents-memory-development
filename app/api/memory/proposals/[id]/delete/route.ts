import { NextResponse } from "next/server";

import { notFound, unavailable } from "@/lib/http";
import { deleteProposal } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const deleted = await deleteProposal(id);
    if (!deleted) {
      return notFound(`no decided proposal with id ${id}`);
    }
    return NextResponse.json({ deleted: true, proposalId: id });
  } catch (error) {
    return unavailable(error);
  }
}
