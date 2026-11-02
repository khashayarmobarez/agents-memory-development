import { NextResponse, type NextRequest } from "next/server";

import { isSessionRequest, requireAppSecret } from "@/lib/app-auth";
import { CODE_TTL_MS, checkAuthorize, issuerOf, seal } from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

/** The consent form posts here. Only a logged-in owner can mint an authorization code. */
export async function POST(request: NextRequest) {
  if (!isSessionRequest(request)) return refuse("unauthorized", 401);

  // The session cookie is SameSite=lax, which already keeps cross-site posts
  // out; checking Origin as well costs one line and survives a cookie change.
  const issuer = issuerOf(request);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== issuer) return refuse("cross-origin request", 403);

  const form = await request.formData().catch(() => null);
  if (!form) return refuse("body must be a form", 400);

  const secret = requireAppSecret();
  const get = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : null;
  };

  // Re-validate everything: the hidden fields came back through the browser.
  const checked = checkAuthorize(get, secret, issuer);
  if (!checked.ok) return refuse(checked.error, 400);

  const { params } = checked;
  const target = new URL(params.redirectUri);
  if (params.state !== "") target.searchParams.set("state", params.state);

  if (get("decision") !== "approve") {
    target.searchParams.set("error", "access_denied");
    return NextResponse.redirect(target, 303);
  }

  const code = seal(
    "code",
    {
      cid: params.clientId,
      ru: params.redirectUri,
      cc: params.codeChallenge,
      res: params.resource,
    },
    CODE_TTL_MS,
    secret,
  );
  target.searchParams.set("code", code);
  return NextResponse.redirect(target, 303);
}
