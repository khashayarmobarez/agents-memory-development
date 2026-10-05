import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "memory_session";

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/**
 * Stateless session token: base64url(expiryMs).hmac. No storage, so the only
 * revocation is rotating APP_SECRET — which invalidates every session at once.
 */
export function createSessionToken(secret: string, ttlMs: number): string {
  const expiry = String(Date.now() + ttlMs);
  const payload = Buffer.from(expiry).toString("base64url");
  return `${payload}.${sign(expiry, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
): boolean {
  if (!token) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expiry = Buffer.from(payload, "base64url").toString("utf8");
  const expected = sign(expiry, secret);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);

  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return false;
  }

  const expiryMs = Number(expiry);
  return Number.isFinite(expiryMs) && expiryMs > Date.now();
}
