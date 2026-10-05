import Link from "next/link";

import { listProposals } from "@/lib/memory";

import SignOut from "../sign-out";
import ManageList from "./manage-list";

// Deletion rescans the record, so the page must never serve a cached list.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ManagePage() {
  const [approved, rejected] = await Promise.all([
    listProposals("approved"),
    listProposals("rejected"),
  ]);

  const items = [...approved, ...rejected].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header>
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
            Disposal
          </p>
          <div className="flex items-baseline gap-4">
            <Link
              href="/memory"
              className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-faint transition-colors hover:text-ink"
            >
              &larr; Approval desk
            </Link>
            <SignOut />
          </div>
        </div>

        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          Manage memories.
        </h1>

        <p className="mt-5 border-l-2 border-ink pl-4 font-display text-[15px] italic leading-relaxed text-ink-soft">
          Everything the desk has decided. Deletion is permanent: an approved
          memory is removed from search along with its Decision and Source, a
          rejected one is removed from the record entirely. Pending proposals
          are decided on the approval desk first.
        </p>
      </header>

      <div aria-hidden className="mt-9 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <div className="mt-8">
        <ManageList initial={items} />
      </div>
    </div>
  );
}
