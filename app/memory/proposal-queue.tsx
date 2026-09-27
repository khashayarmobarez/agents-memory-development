"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Proposal } from "@/lib/types";

const TYPE_STYLES: Record<Proposal["type"], string> = {
  decision:
    "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  convention: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  note: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

// Deliberately not toLocaleString(): this component renders on the server too,
// and a locale-dependent format risks a hydration mismatch.
function formatUtc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

type Decision = "approve" | "reject";

export default function ProposalQueue({ initial }: { initial: Proposal[] }) {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState<string | null>(null);

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

      // It has left the pending queue, so drop it locally for an instant
      // response, then refresh so the server-rendered counts catch up.
      setProposals((current) => current.filter((item) => item.id !== id));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request failed");
    } finally {
      setBusy(null);
    }
  }

  if (proposals.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
        Nothing waiting. New proposals from agents show up here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {proposals.map((proposal) => {
        const isBusy = busy === proposal.id;
        const isOpen = openContent === proposal.id;

        return (
          <article
            key={proposal.id}
            className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[proposal.type]}`}
              >
                {proposal.type}
              </span>
              <span className="text-xs text-neutral-500">{proposal.projectId}</span>
              <span className="ml-auto text-xs text-neutral-400">
                {formatUtc(proposal.createdAt)}
              </span>
            </div>

            <h2 className="mt-3 text-base font-medium">{proposal.title}</h2>

            <button
              type="button"
              onClick={() => setOpenContent(isOpen ? null : proposal.id)}
              className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              {isOpen ? "Hide content" : "Show content"}
            </button>

            {isOpen && (
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-neutral-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
                {proposal.content}
              </pre>
            )}

            <p className="mt-4 text-xs text-neutral-500">
              source: <span className="font-mono">{proposal.sourceType}</span>
              {" :: "}
              <span className="font-mono">{proposal.sourceReference}</span>
            </p>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => decide(proposal.id, "approve")}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isBusy ? "Working..." : "Approve"}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => decide(proposal.id, "reject")}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
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
