import Link from "next/link";

import { listProposals } from "@/lib/memory";

import ProposalQueue from "./proposal-queue";

// The queue is read at request time and must never be cached: a stale page would
// show proposals that are no longer pending, and the buttons would 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MemoryPage() {
  // Reads go straight to the domain functions the API routes also use. There is
  // no invariant to protect on a read, so a self-HTTP hop would buy nothing.
  const [pending, approved, rejected] = await Promise.all([
    listProposals("pending"),
    listProposals("approved"),
    listProposals("rejected"),
  ]);

  const recentlyApproved = approved.slice(0, 5);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header>
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
            Approval desk
          </p>
          <Link
            href="/"
            className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-faint transition-colors hover:text-ink"
          >
            &larr; Front desk
          </Link>
        </div>

        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          Memory proposals.
        </h1>

        <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-ink-faint">
          Pending{" "}
          <span className="font-semibold text-stamp-red">{pending.length}</span>
          {"  \u00B7  "}Approved{" "}
          <span className="font-semibold text-stamp-green">
            {approved.length}
          </span>
          {"  \u00B7  "}Rejected{" "}
          <span className="font-semibold text-ink">{rejected.length}</span>
        </p>

        <p className="mt-5 border-l-2 border-ink pl-4 font-display text-[15px] italic leading-relaxed text-ink-soft">
          Approving promotes a proposal to a Decision that agents can search.
          Rejecting keeps it out of search permanently. Neither is undoable
          from here, and agents can propose but never approve.
        </p>
      </header>

      <div aria-hidden className="mt-9 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <div className="mt-8">
        <ProposalQueue initial={pending} />
      </div>

      {recentlyApproved.length > 0 && (
        <section className="mt-14">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
            Entered into the record
          </h2>
          <ul className="mt-4 space-y-3">
            {recentlyApproved.map((proposal) => (
              <li key={proposal.id} className="flex items-baseline gap-3">
                <span className="shrink-0 font-mono text-xs text-ink-faint">
                  {proposal.createdAt.slice(0, 16).replace("T", " ")} UTC
                </span>
                <span className="font-display text-[15px] font-medium">
                  {proposal.title}
                </span>
                <span
                  aria-hidden
                  className="mx-1 flex-1 -translate-y-1 border-b border-dotted border-rule"
                />
                <span className="shrink-0 font-mono text-xs text-ink-faint">
                  {proposal.projectId}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
