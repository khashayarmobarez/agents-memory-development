import { NextResponse } from "next/server";

import { getBloomGraph } from "@/lib/bloom";
import { unavailable } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The chamber's refresh handle. Read-only by construction: getBloomGraph only
// ever MATCHes. Session-gated like every non-machine route via proxy.ts.
export async function GET() {
  try {
    const graph = await getBloomGraph();
    return NextResponse.json(graph);
  } catch (error) {
    return unavailable(error);
  }
}
