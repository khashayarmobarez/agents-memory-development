import { NextResponse } from "next/server";

import { badRequest, notFound, unavailable } from "@/lib/http";
import { renameWorkspace } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("body must be valid JSON");
  }

  const title =
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).title === "string"
      ? ((body as Record<string, unknown>).title as string).trim()
      : "";

  if (title === "") {
    return badRequest("title is required and must be a non-empty string");
  }

  try {
    const renamed = await renameWorkspace(id, title);
    if (!renamed) return notFound(`no workspace with id "${id}"`);
    return NextResponse.json({ workspace: { id, title } });
  } catch (error) {
    return unavailable(error);
  }
}
