import { NextResponse } from "next/server";

import { checkPassword, requireAppSecret } from "@/lib/app-auth";
import { SESSION_COOKIE, createSessionToken } from "@/lib/app-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }

  const password = (body as { password?: unknown } | null)?.password;
  if (typeof password !== "string" || password === "") {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }

  let ok: boolean;
  try {
    ok = checkPassword(password);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server misconfigured" },
      { status: 503 },
    );
  }

  if (!ok) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  let secret: string;
  try {
    secret = requireAppSecret();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server misconfigured" },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(secret, WEEK_MS), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK_MS / 1000,
  });
  return response;
}
