import { NextResponse } from "next/server";

import { badRequest, unavailable } from "@/lib/http";
import { createWorkspace } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseWorkspace(body: unknown):
  | { ok: true; value: { id: string; title: string } }
  | { ok: false; errors: string[] } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  const id = typeof b.id === "string" && b.id.trim() !== "" ? b.id.trim() : "";
  const title =
    typeof b.title === "string" && b.title.trim() !== "" ? b.title.trim() : "";

  if (id === "") errors.push("id is required and must be a non-empty string");
  if (title === "") errors.push("title is required and must be a non-empty string");

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { id, title } };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("body must be valid JSON");
  }

  const parsed = parseWorkspace(body);
  if (!parsed.ok) return badRequest("validation failed", parsed.errors);

  try {
    const workspace = await createWorkspace(parsed.value);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    return unavailable(error);
  }
}
