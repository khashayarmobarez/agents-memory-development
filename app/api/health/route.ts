import { NextResponse } from "next/server";

import { query, toNumber } from "@/lib/neo4j";

// This route hits the database on every request. Without force-dynamic, Next may
// try to evaluate it during the build and cache whatever it got.
export const dynamic = "force-dynamic";

// neo4j-driver depends on Node APIs; it cannot run on the edge runtime.
export const runtime = "nodejs";

export async function GET() {
  try {
    const [row] = await query<{ ok: number }>(
      "RETURN 1 AS ok",
      {},
      (record) => ({ ok: toNumber(record.get("ok")) }),
    );

    return NextResponse.json({ ok: row?.ok === 1 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
