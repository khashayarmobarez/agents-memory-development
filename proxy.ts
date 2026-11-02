import { NextResponse, type NextRequest } from "next/server";

import { isKeyRequest, isSessionRequest } from "@/lib/app-auth";

// The login handshake and the health probe (the Vercel cron pings it) are the
// only unauthenticated doors, plus the OAuth surface for remote MCP clients.
// Everything else — pages and API alike — needs a session cookie or, for the
// agent endpoints, the machine key.
//
// The OAuth routes are open here because each guards itself: discovery and
// registration grant nothing, /oauth/authorize and /api/oauth/decide require the
// owner's session (the page redirects to /login itself, since the redirect below
// would drop its query string), /api/oauth/token needs a valid code or refresh
// token, and /api/mcp needs an access token.
const PUBLIC_PREFIXES = [
  "/api/health",
  "/api/auth",
  "/api/oauth",
  "/api/mcp",
  "/.well-known",
  "/oauth/authorize",
];

// What the machine key may do: file proposals (including deletion requests)
// and read. Deciding — approve, reject, delete — is a human session, always.
function machineAllowed(pathname: string, method: string): boolean {
  if (pathname === "/api/memory/proposals" && method === "POST") return true;
  if (pathname === "/api/memory/search" && method === "GET") return true;
  return /^\/api\/memory\/projects\/[^/]+\/context$/.test(pathname) && method === "GET";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return NextResponse.next();
  }

  const session = isSessionRequest(request);

  if (pathname.startsWith("/api/")) {
    const method = request.method.toUpperCase();
    if (session || (machineAllowed(pathname, method) && isKeyRequest(request))) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (pathname === "/login") {
    return session
      ? NextResponse.redirect(new URL("/memory", request.url))
      : NextResponse.next();
  }

  if (session) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/|_vercel/|favicon.ico|icon.svg).*)"],
};
