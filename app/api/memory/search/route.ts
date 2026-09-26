import { NextResponse } from "next/server";

import { unavailable } from "@/lib/http";
import { searchMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const projectId = searchParams.get("projectId")?.trim() || undefined;

  try {
    const memory = await searchMemory({ q, projectId });
    return NextResponse.json({ memory, count: memory.length });
  } catch (error) {
    return unavailable(error);
  }
}
