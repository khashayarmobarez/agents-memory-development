"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Proposal } from "@/lib/types";

import { TYPE_TABS, formatUtc } from "./presentation";

type Decision = "approve" | "reject";

const STAMP_MARK: Record<Decision, { text: string; className: string }> = {
  approve: {
    text: "Approved",
    className: "border-stamp-green text-stamp-green ring-stamp-green",
  },
  reject: {
    text: "Rejected",
    className: "border-stamp-red text-stamp-red ring-stamp-red",
  },
};

export default function ProposalQueue({ initial }: { initial: Proposal[] }) {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Decision>>({});

  async function decide(id: string, decision: Decision) {
    setBusy(id);
    setError(null);

    try {
      // Through the public API, not the domain functions: the approval path has
      // exactly one entry point, and this page is no more privileged than any
      // other client — opencode included.
      const response = await fetch(`/api/memory/proposals/${id}/${decision}`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? `${response.status} ${response.statusText}`);
      }

      // The stamp lands, the paper sits on the desk a beat, then it leaves.
      setDecided((current) => ({ ...current, [id]: decision }));
      window.setTimeout(() => {
        setProposals((current) => current.filter((item) => item.id !== id));
        setBusy(null);
        setDecided((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        router.refresh();
      }, 520);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request failed");
      setBusy(null);
    }
  }

  if (proposals.length === 0) {
    return (
      <div className="border-2 border-dashed border-rule bg-paper-raised p-12 text-center">
        <p className="font-display text-2xl italic text-ink-soft">
          Nothing waiting.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-faint">
          New proposals from agents show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error !== null && (
        <p
          role="alert"
          className="border-2 border-stamp-red bg-paper-raised px-4 py-3 font-mono text-xs leading-relaxed text-stamp-red"
        >
          {error}
        </p>
      )}

      {proposals.map((proposal, index) => {
        const isBusy = busy === proposal.id;
        const isOpen = openContent === proposal.id;
        const decision = decided[proposal.id];
        const stamp = decision !== undefined ? STAMP_MARK[decision] : null;

        return (
          <article
            key={proposal.id}
            className="reveal relative border border-ink/20 bg-paper-raised p-5 shadow-[5px_5px_0_0_var(--rule)] sm:p-6"
            style={{ animationDelay: `${index * 70}ms` }}
          >
            {stamp !== null && (
              <div className="stamp pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <span
                  className={`-rotate-6 border-2 px-7 py-2 font-mono text-2xl font-semibold uppercase tracking-[0.3em] ring-1 ring-offset-2 ring-offset-paper-raised ${stamp.className}`}
                >
                  {stamp.text}
                </span>
              </div>
            )}

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
            </div>

            <h2 className="mt-3.5 font-display text-xl font-semibold leading-snug">
              {proposal.title}
            </h2>

            <button
              type="button"
              onClick={() => setOpenContent(isOpen ? null : proposal.id)}
              className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft underline decoration-dotted decoration-rule underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              {isOpen ? "Hide content" : "Show content"}
            </button>

            {isOpen && (
              <pre className="mt-3 max-h-96 overflow-auto border-l-2 border-rule bg-paper-deep p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
                {proposal.content}
              </pre>
            )}

            <p className="mt-4 border-t border-dotted border-rule pt-3 font-mono text-[11px] text-ink-faint">
              <span className="uppercase tracking-[0.18em]">source</span>
              {" :: "}
              <span className="text-ink-soft">
                {proposal.sourceType} :: {proposal.sourceReference}
              </span>
            </p>

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => decide(proposal.id, "approve")}
                className="border-2 border-stamp-green bg-stamp-green px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-paper-raised transition-all hover:enabled:-translate-y-px hover:enabled:shadow-[3px_3px_0_0_var(--ink)] active:enabled:scale-[0.97] disabled:opacity-40"
              >
                {isBusy ? "Stamping\u2026" : "Approve"}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => decide(proposal.id, "reject")}
                className="border-2 border-stamp-red px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-stamp-red transition-colors hover:enabled:bg-stamp-red hover:enabled:text-paper-raised disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
