import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * OAuth 2.1 for the remote MCP endpoint, built on the same idea as the session
 * cookie: no storage. Every artifact is a signed, self-describing token, so the
 * only revocation is rotating APP_SECRET — which also logs the owner out.
 *
 * Each kind is signed with its own derived key, so a token of one kind (or a
 * session cookie) can never be replayed as another.
 */
export type TokenKind = "client" | "code" | "access" | "refresh";

export const SCOPE = "memory";
export const CODE_TTL_MS = 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const keyFor = (kind: TokenKind, secret: string) =>
  createHmac("sha256", secret).update(`oauth:${kind}`).digest();

const sign = (kind: TokenKind, body: string, secret: string) =>
  createHmac("sha256", keyFor(kind, secret)).update(body).digest("base64url");

/** `ttlMs: null` makes a token that never expires (client registrations). */
export function seal(
  kind: TokenKind,
  claims: Record<string, unknown>,
  ttlMs: number | null,
  secret: string,
): string {
  const payload = ttlMs === null ? claims : { ...claims, exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(kind, body, secret)}`;
}

export function open(
  kind: TokenKind,
  token: string | null | undefined,
  secret: string,
): Record<string, unknown> | null {
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const given = Buffer.from(signature);
  const wanted = Buffer.from(sign(kind, body, secret));
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;

  const record = claims as Record<string, unknown>;
  if (typeof record.exp === "number" && record.exp <= Date.now()) return null;
  return record;
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(
    createHash("sha256").update(verifier).digest("base64url"),
  );
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/**
 * Redirect targets are the one place a registration can aim a code at someone
 * else's server, so only https and loopback http are accepted, never a fragment.
 */
export function isAllowedRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== "") return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}

export interface Client {
  name: string;
  redirectUris: string[];
}

/** A client id is the registration itself, signed — so there is nothing to look up. */
export function openClient(clientId: string | null | undefined, secret: string): Client | null {
  const claims = open("client", clientId, secret);
  if (!claims) return null;
  if (typeof claims.name !== "string" || !Array.isArray(claims.redirectUris)) return null;
  const redirectUris = claims.redirectUris.filter(
    (uri): uri is string => typeof uri === "string",
  );
  return { name: claims.name, redirectUris };
}

/** The public origin; PUBLIC_URL overrides it when a proxy hides the real host. */
export function issuerOf(request: Request): string {
  const configured = process.env.PUBLIC_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/+$/, "");
}

/** Same answer from request headers, for server components that have no Request. */
export function issuerFromHeaders(headers: Pick<Headers, "get">): string {
  const configured = process.env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const proto =
    headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const resourceOf = (issuer: string) => `${issuer}/api/mcp`;

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
};

export function json(body: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: { ...CORS_HEADERS, "cache-control": "no-store", ...init.headers },
  });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
  resource: string;
}

/**
 * Validates an authorization request against the signed client. A failure here
 * must be shown to the owner, never redirected: the redirect_uri is the thing
 * that could not be trusted.
 */
export function checkAuthorize(
  get: (key: string) => string | null | undefined,
  secret: string,
  issuer: string,
): { ok: true; client: Client; params: AuthorizeParams } | { ok: false; error: string } {
  const clientId = get("client_id") ?? "";
  const client = openClient(clientId, secret);
  if (!client) return { ok: false, error: "Unknown client." };

  const redirectUri = get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: "redirect_uri does not match the client's registration." };
  }
  if ((get("response_type") ?? "code") !== "code") {
    return { ok: false, error: "Only response_type=code is supported." };
  }

  const codeChallenge = get("code_challenge") ?? "";
  if (codeChallenge === "" || (get("code_challenge_method") ?? "S256") !== "S256") {
    return { ok: false, error: "PKCE with code_challenge_method=S256 is required." };
  }

  const resource = get("resource") || resourceOf(issuer);
  if (resource !== resourceOf(issuer)) {
    return { ok: false, error: "Unknown resource." };
  }

  return {
    ok: true,
    client,
    params: {
      clientId,
      redirectUri,
      codeChallenge,
      state: get("state") ?? "",
      scope: SCOPE,
      resource,
    },
  };
}
