import Link from "next/link";

import { listProposals } from "@/lib/memory";

import DecidedList from "./decided-list";
import ProposalQueue from "./proposal-queue";

// The queue is read at request time and must never be cached: a stale page would
// show proposals that are no longer pending, and the buttons would 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABS = ["pending", "approved", "rejected"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

// The accent each count wears when its tab is not the open folder.
const COUNT_COLORS: Record<Tab, string> = {
  pending: "text-stamp-red",
  approved: "text-stamp-green",
  rejected: "text-ink-soft",
};

const TAB_BASE =
  "border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors";
const TAB_ACTIVE = "border-ink bg-ink text-paper-raised";
const TAB_INACTIVE =
  "border-ink/20 bg-paper-raised text-ink-faint hover:border-ink hover:text-ink";

export default async function MemoryPage({
  searchParams,
}: PageProps<"/memory">) {
  // Reads go straight to the domain functions the API routes also use. There is
  // no invariant to protect on a read, so a self-HTTP hop would buy nothing.
  const [pending, approved, rejected] = await Promise.all([
    listProposals("pending"),
    listProposals("approved"),
    listProposals("rejected"),
  ]);

  // Tabs are URL state (?tab=), so every list is shareable and always fresh —
  // a stamp on one tab is a server render away on the next.
  const requested = (await searchParams).tab;
  const tabValue = Array.isArray(requested) ? requested[0] : requested;
  const tab: Tab = TABS.find((value) => value === tabValue) ?? "pending";

  const counts: Record<Tab, number> = {
    pending: pending.length,
    approved: approved.length,
    rejected: rejected.length,
  };

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

        <p className="mt-5 border-l-2 border-ink pl-4 font-display text-[15px] italic leading-relaxed text-ink-soft">
          Approving promotes a proposal to a Decision that agents can search.
          Rejecting keeps it out of search permanently. Neither is undoable
          from here, and agents can propose but never approve.
        </p>
      </header>

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Review status" className="flex flex-wrap gap-2">
          {TABS.map((value) => {
            const active = value === tab;

            return (
              <Link
                key={value}
                href={value === "pending" ? "/memory" : `/memory?tab=${value}`}
                aria-current={active ? "page" : undefined}
                className={`${TAB_BASE} ${active ? TAB_ACTIVE : TAB_INACTIVE}`}
              >
                {TAB_LABELS[value]}{" "}
                <span
                  className={`font-semibold ${active ? "" : COUNT_COLORS[value]}`}
                >
                  {counts[value]}
                </span>
              </Link>
            );
          })}
        </nav>

        <Link
          href="/memory/manage"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint transition-colors hover:text-ink"
        >
          Manage memories &rarr;
        </Link>
      </div>

      <div aria-hidden className="mt-3 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <div className="mt-8">
        {tab === "pending" ? (
          <ProposalQueue initial={pending} />
        ) : (
          <DecidedList
            status={tab}
            proposals={tab === "approved" ? approved : rejected}
          />
        )}
      </div>
    </div>
  );
}
