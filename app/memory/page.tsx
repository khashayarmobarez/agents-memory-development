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
    <div className="mx-auto max-w-3xl px-6 py-10 font-sans">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Memory proposals</h1>
        <p className="mt-2 text-sm text-neutral-500">
          {pending.length} pending &middot; {approved.length} approved &middot;{" "}
          {rejected.length} rejected
        </p>
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          Approving promotes a proposal to a Decision that agents can search.
          Rejecting keeps it out of search permanently. Neither is undoable from
          here, and agents can propose but never approve.
        </p>
      </header>

      <ProposalQueue initial={pending} />

      {recentlyApproved.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Recently approved
          </h2>
          <ul className="mt-3 space-y-2">
            {recentlyApproved.map((proposal) => (
              <li
                key={proposal.id}
                className="text-sm text-neutral-600 dark:text-neutral-400"
              >
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {proposal.title}
                </span>
                <span className="text-neutral-400"> &mdash; {proposal.projectId}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
