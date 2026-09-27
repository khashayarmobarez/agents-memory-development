import Link from "next/link";

interface Destination {
  href: string;
  label: string;
  detail: string;
  /** Leaves this app entirely — gets the "opens external" hint. */
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
  },
  {
    href: "http://localhost:7474",
    label: "Neo4j Browser",
    detail:
      "Inspect the graph directly. Read-only in practice — approving from here breaks the invariant.",
    external: true,
    newTab: true,
  },
  {
    href: "/api/health",
    label: "API health",
    detail: "Returns { ok: true } while the driver can reach Neo4j.",
    newTab: true,
  },
];

const CARD =
  "rounded-xl border border-neutral-200 bg-white p-5 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-20 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Memory system</h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-500">
        Agents propose memories, a human approves them, and only approved knowledge
        becomes searchable.
      </p>

      <nav className="mt-10 grid gap-3">
        {DESTINATIONS.map((destination) => {
          const body = (
            <>
              <span className="flex flex-wrap items-center gap-2 text-base font-medium">
                {destination.label}
                {destination.external === true && (
                  <span className="text-xs font-normal text-neutral-400">
                    opens external
                  </span>
                )}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-neutral-500">
                {destination.detail}
              </span>
            </>
          );

          // Plain anchors for anything that should open in its own tab; Link only
          // for in-app navigation that replaces this page.
          return destination.newTab === true ? (
            <a
              key={destination.href}
              href={destination.href}
              target="_blank"
              rel="noopener noreferrer"
              className={CARD}
            >
              {body}
            </a>
          ) : (
            <Link key={destination.href} href={destination.href} className={CARD}>
              {body}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
