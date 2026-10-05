import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/app-token";

/** Hash both sides first, so timingSafeEqual never sees mismatched lengths. */
function safeEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Fail closed: a missing secret reads as "no session", never as "valid". */
export function isSessionRequest(request: NextRequest): boolean {
  const secret = process.env.APP_SECRET;
  if (!secret) return false;
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret);
}

/** Bearer check; a missing MEMORY_API_KEY simply disables machine access. */
export function isKeyRequest(request: Request): boolean {
  const expected = process.env.MEMORY_API_KEY;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;

  return safeEqual(token, expected);
}

export function requireAppSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error("APP_SECRET is not set — add it to .env.local (see README)");
  }
  return secret;
}

export function requireAppPassword(): string {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    throw new Error("APP_PASSWORD is not set — add it to .env.local (see README)");
  }
  return password;
}

export function checkPassword(candidate: string): boolean {
  return safeEqual(candidate, requireAppPassword());
}
