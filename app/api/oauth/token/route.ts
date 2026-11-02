import { requireAppSecret } from "@/lib/app-auth";
import { messageOf } from "@/lib/http";
import {
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  SCOPE,
  json,
  open,
  openClient,
  pkceMatches,
  preflight,
  seal,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fail = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, { status });

const field = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

function issue(clientId: string, resource: string, secret: string) {
  return json({
    access_token: seal("access", { cid: clientId, scope: SCOPE, aud: resource }, ACCESS_TTL_MS, secret),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: seal("refresh", { cid: clientId, scope: SCOPE, aud: resource }, REFRESH_TTL_MS, secret),
    scope: SCOPE,
  });
}

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = requireAppSecret();
  } catch (error) {
    return fail("server_error", messageOf(error), 503);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return fail("invalid_request", "body must be application/x-www-form-urlencoded");

  const clientId = field(form, "client_id");
  if (!openClient(clientId, secret)) return fail("invalid_client", "unknown client_id", 401);

  const grant = field(form, "grant_type");

  if (grant === "authorization_code") {
    const code = open("code", field(form, "code"), secret);
    const verifier = field(form, "code_verifier");

    // One message for every failure: which check failed is not the caller's business.
    const bad = () => fail("invalid_grant", "authorization code is invalid or expired");

    if (!code || code.cid !== clientId) return bad();
    if (code.ru !== field(form, "redirect_uri")) return bad();
    if (typeof code.cc !== "string" || verifier === "" || !pkceMatches(verifier, code.cc)) {
      return bad();
    }
    return issue(clientId, String(code.res), secret);
  }

  if (grant === "refresh_token") {
    const refresh = open("refresh", field(form, "refresh_token"), secret);
    if (!refresh || refresh.cid !== clientId) {
      return fail("invalid_grant", "refresh token is invalid or expired");
    }
    return issue(clientId, String(refresh.aud), secret);
  }

  return fail("unsupported_grant_type", "use authorization_code or refresh_token");
}

export const OPTIONS = preflight;
