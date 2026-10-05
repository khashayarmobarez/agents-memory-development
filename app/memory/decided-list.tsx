import type { Proposal } from "@/lib/types";

import {
  MARKS,
  TYPE_TABS,
  formatUtc,
  type DecidedStatus,
} from "./presentation";

const EMPTY: Record<DecidedStatus, { title: string; detail: string }> = {
  approved: {
    title: "The record is empty.",
    detail: "Approve a proposal and it enters the record here.",
  },
  rejected: {
    title: "Nothing discarded.",
    detail: "Rejected proposals end up here — out of search, permanently.",
  },
};

export default function DecidedList({
  status,
  proposals,
}: {
  status: DecidedStatus;
  proposals: Proposal[];
}) {
  const mark = MARKS[status];
  const empty = EMPTY[status];

  if (proposals.length === 0) {
    return (
      <div className="border-2 border-dashed border-rule bg-paper-raised p-12 text-center">
        <p className="font-display text-2xl italic text-ink-soft">
          {empty.title}
        </p>
        <p className="mt-2 font-mono text-xs text-ink-faint">{empty.detail}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {proposals.map((proposal, index) => (
        <article
          key={proposal.id}
          className="reveal relative border border-ink/20 bg-paper-raised p-5 shadow-[5px_5px_0_0_var(--rule)]"
          style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${TYPE_TABS[proposal.type]}`}
            >
              {proposal.type}
            </span>
            <span className="font-mono text-xs text-ink-faint">
              {proposal.projectId}
            </span>
            <span className="ml-auto font-mono text-xs text-ink-faint">
              {formatUtc(proposal.createdAt)}
            </span>
            <span
              className={`-rotate-3 border-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${mark.className}`}
            >
              {mark.text}
            </span>
          </div>

          <h2 className="mt-3.5 font-display text-lg font-semibold leading-snug">
            {proposal.title}
          </h2>

          {proposal.type === "deletion" && (
            <p className="mt-2 font-mono text-[11px] text-ink-faint">
              {status === "approved" ? "deleted" : "targeted"}:{" "}
              {proposal.targetTitle ?? proposal.targetId ?? "unknown target"}
            </p>
          )}

          <pre className="mt-3 max-h-64 overflow-auto border-l-2 border-rule bg-paper-deep p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
            {proposal.content}
          </pre>

          <p className="mt-4 border-t border-dotted border-rule pt-3 font-mono text-[11px] text-ink-faint">
            <span className="uppercase tracking-[0.18em]">source</span>
            {" :: "}
            <span className="text-ink-soft">
              {proposal.sourceType} :: {proposal.sourceReference}
            </span>
          </p>
        </article>
      ))}
    </div>
  );
}
