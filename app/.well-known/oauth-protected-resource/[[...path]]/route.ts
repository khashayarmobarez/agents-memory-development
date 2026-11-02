import { SCOPE, issuerOf, json, preflight, resourceOf } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * RFC 9728. Clients ask for /.well-known/oauth-protected-resource/<resource path>,
 * so the optional catch-all answers both that and the bare form.
 */
export function GET(request: Request) {
  const issuer = issuerOf(request);
  return json({
    resource: resourceOf(issuer),
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Memory system",
  });
}

export const OPTIONS = preflight;
