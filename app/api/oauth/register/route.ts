import { requireAppSecret } from "@/lib/app-auth";
import { messageOf } from "@/lib/http";
import { isAllowedRedirect, json, preflight, seal } from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const invalid = (description: string) =>
  json({ error: "invalid_client_metadata", error_description: description }, { status: 400 });

/**
 * RFC 7591 dynamic registration. It is open to anyone, which is safe because a
 * registration grants nothing: the owner still has to log in and approve it on
 * the consent screen, which shows where the code would be sent.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("body must be valid JSON");
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return invalid("redirect_uris must be a non-empty array");
  }
  if (!uris.every((uri) => typeof uri === "string" && isAllowedRedirect(uri))) {
    return invalid("redirect_uris must be https URLs (or http on localhost) without a fragment");
  }

  const name =
    typeof input.client_name === "string" && input.client_name.trim() !== ""
      ? input.client_name.trim().slice(0, 80)
      : "Unnamed client";

  let secret: string;
  try {
    secret = requireAppSecret();
  } catch (error) {
    return json({ error: "server_error", error_description: messageOf(error) }, { status: 503 });
  }

  const clientId = seal("client", { name, redirectUris: uris }, null, secret);
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}

export const OPTIONS = preflight;
