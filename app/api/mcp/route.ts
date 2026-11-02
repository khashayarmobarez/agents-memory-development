import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { requireAppSecret } from "@/lib/app-auth";
import { CORS_HEADERS, issuerOf, open, resourceOf } from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Remote MCP endpoint for claude.ai connectors. The proxy lets it through
 * because it authenticates itself: an OAuth access token minted by /api/oauth.
 * The 401 carries the pointer a client follows to start the OAuth flow.
 */
function unauthorized(issuer: string, reason: string) {
  return Response.json(
    { error: "unauthorized", error_description: reason },
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/api/mcp"`,
      },
    },
  );
}

async function handle(request: Request): Promise<Response> {
  const issuer = issuerOf(request);

  const [scheme, token] = (request.headers.get("authorization") ?? "").split(" ");
  const claims = scheme === "Bearer" ? open("access", token, requireAppSecret()) : null;
  if (!claims || claims.aud !== resourceOf(issuer)) {
    return unauthorized(issuer, "a valid access token is required");
  }

  // Imported here, not at the top: lib/memory opens the Neo4j driver at module
  // load, and an unauthenticated request should get its 401 without touching it.
  const { createMemoryMcpServer } = await import("@/lib/mcp-tools");

  // Stateless: a fresh server and transport per request, JSON instead of SSE.
  // Nothing here needs server-initiated messages, and serverless has no place
  // to keep a session between requests.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await createMemoryMcpServer().connect(transport);

  const response = await transport.handleRequest(request);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
