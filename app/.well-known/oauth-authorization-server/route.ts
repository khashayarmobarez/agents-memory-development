import { SCOPE, issuerOf, json, preflight } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** RFC 8414 authorization-server metadata. */
export function GET(request: Request) {
  const issuer = issuerOf(request);
  return json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

export const OPTIONS = preflight;
