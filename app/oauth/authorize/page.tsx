import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireAppSecret } from "@/lib/app-auth";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/app-token";
import { checkAuthorize, issuerFromHeaders } from "@/lib/oauth";

export const dynamic = "force-dynamic";

type Search = { [key: string]: string | string[] | undefined };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-20">
      {children}
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;
  const secret = requireAppSecret();

  // The proxy lets this page through (it would drop the query string on the way
  // to /login), so the session check lives here.
  const session = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, secret);
  if (!session) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      const single = first(value);
      if (single !== undefined) query.set(key, single);
    }
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  }

  const issuer = issuerFromHeaders(await headers());
  const checked = checkAuthorize((key) => first(search[key]), secret, issuer);

  if (!checked.ok) {
    return (
      <Shell>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
          Request refused
        </p>
        <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight">
          Cannot authorize.
        </h1>
        <p
          role="alert"
          className="mt-6 border-2 border-stamp-red bg-paper-raised px-4 py-3 font-mono text-xs leading-relaxed text-stamp-red"
        >
          {checked.error}
        </p>
      </Shell>
    );
  }

  const { client, params } = checked;
  const destination = new URL(params.redirectUri).host;

  return (
    <Shell>
      <header className="reveal">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
          Connector request
        </p>
        <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight">
          {client.name}
        </h1>
        <p className="mt-5 font-display text-[15px] italic leading-relaxed text-ink-soft">
          wants to read approved memory and file proposals. It can never approve,
          reject or delete — only you can, at the desk.
        </p>
      </header>

      <div aria-hidden className="mt-9 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <p className="mt-8 font-mono text-xs leading-relaxed text-ink-soft">
        After you decide, you are sent back to{" "}
        <span className="font-semibold text-ink">{destination}</span>. If that is
        not where you started, deny.
      </p>

      <form method="post" action="/api/oauth/decide" className="mt-8 space-y-3">
        <input type="hidden" name="client_id" value={params.clientId} />
        <input type="hidden" name="redirect_uri" value={params.redirectUri} />
        <input type="hidden" name="code_challenge" value={params.codeChallenge} />
        <input type="hidden" name="state" value={params.state} />
        <input type="hidden" name="resource" value={params.resource} />
        <button
          type="submit"
          name="decision"
          value="approve"
          className="w-full border-2 border-stamp-green bg-stamp-green px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-paper-raised transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--ink)] active:scale-[0.99]"
        >
          Allow access
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="w-full border-2 border-ink/30 px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-ink-soft transition-colors hover:border-ink"
        >
          Deny
        </button>
      </form>
    </Shell>
  );
}
