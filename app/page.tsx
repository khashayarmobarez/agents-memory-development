import Link from "next/link";

interface Destination {
  href: string;
  label: string;
  detail: string;
  /** Drawer code stamped on the index card. */
  code: string;
  /** Leaves this app entirely — gets the "off-site" mark. */
  external?: boolean;
  /** Rendered as a plain anchor so it opens in a new tab. */
  newTab?: boolean;
}

const DESTINATIONS: Destination[] = [
  {
    href: "/memory",
    label: "Review proposals",
    detail:
      "The approval queue. Everything agents have proposed, waiting on a human yes or no.",
    code: "A/01",
  },
  {
    href: "https://console.neo4j.io",
    label: "Aura console",
    detail:
      "The graph behind this desk, in Neo4j's cloud. Read-only in practice — approving by hand breaks the invariant.",
    code: "A/02",
    external: true,
    newTab: true,
  },
  {
    href: "/api/health",
    label: "API health",
    detail: "Returns { ok: true } while the driver can reach Neo4j.",
    code: "A/03",
    newTab: true,
  },
];

const CARD =
  "reveal block border border-ink/20 bg-paper-raised p-5 shadow-[4px_4px_0_0_var(--rule)] transition-all duration-200 hover:-translate-y-0.5 hover:border-ink hover:shadow-[6px_6px_0_0_var(--ink)]";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <header className="reveal relative">
        <div
          aria-hidden
          className="absolute right-0 top-9 hidden -rotate-[8deg] border-2 border-stamp-red px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-stamp-red ring-1 ring-stamp-red ring-offset-2 ring-offset-paper sm:block"
        >
          Human approval required
        </div>

        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
          Bureau of machine memory
        </p>
        <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Memory system.
        </h1>
        <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">
          Agents propose memories, a human approves them, and only approved
          knowledge becomes searchable.
        </p>
        <p className="mt-6 max-w-[52ch] font-display text-[15px] italic leading-relaxed text-ink-faint">
          The point is not storage. The point is that an agent&rsquo;s confident
          guess never becomes established fact without a human saying so.
        </p>
      </header>

      <div aria-hidden className="mt-10 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <nav className="mt-8 grid gap-4">
        {DESTINATIONS.map((destination, index) => {
          const body = (
            <>
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
                <span>{destination.code}</span>
                {destination.external === true && (
                  <span className="text-stamp-red">off-site</span>
                )}
              </div>
              <span className="mt-3 block font-display text-xl font-semibold">
                {destination.label}
              </span>
              <span className="mt-1.5 block text-sm leading-relaxed text-ink-soft">
                {destination.detail}
              </span>
            </>
          );

          // Plain anchors for anything that should open in its own tab; Link
          // only for in-app navigation that replaces this page.
          return destination.newTab === true ? (
            <a
              key={destination.href}
              href={destination.href}
              target="_blank"
              rel="noopener noreferrer"
              className={CARD}
              style={{ animationDelay: `${120 + index * 80}ms` }}
            >
              {body}
            </a>
          ) : (
            <Link
              key={destination.href}
              href={destination.href}
              className={CARD}
              style={{ animationDelay: `${120 + index * 80}ms` }}
            >
              {body}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
