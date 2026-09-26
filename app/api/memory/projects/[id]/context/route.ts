import { NextResponse } from "next/server";

import { notFound, unavailable } from "@/lib/http";
import { getProjectContext } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The context payload an agent loads at the start of a session. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const context = await getProjectContext(id);
    if (context === null) {
      return notFound(`no project with id ${id}`);
    }
    return NextResponse.json(context);
  } catch (error) {
    return unavailable(error);
  }
}
