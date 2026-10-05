"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { Proposal } from "@/lib/types";

import {
  MARKS,
  TYPE_TABS,
  formatUtc,
  type DecidedStatus,
} from "../presentation";

function statusOf(proposal: Proposal): DecidedStatus {
  return proposal.status === "approved" ? "approved" : "rejected";
}

export default function ManageList({ initial }: { initial: Proposal[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Proposal[]>(initial);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return items;
    return items.filter(
      (proposal) =>
        proposal.title.toLowerCase().includes(q) ||
        proposal.content.toLowerCase().includes(q) ||
        proposal.projectId.toLowerCase().includes(q),
    );
  }, [items, query]);

  // Selection is scoped to what the search shows; hidden picks never travel.
  const chosen = useMemo(
    () => visible.filter((proposal) => selected.has(proposal.id)),
    [visible, selected],
  );

  const allSelected = visible.length > 0 && chosen.length === visible.length;
  const busy = progress !== null;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((p) => p.id)));
    setConfirming(false);
  }

  async function removeSelected() {
    if (chosen.length === 0) return;

    setProgress({ done: 0, total: chosen.length });
    setError(null);
    const failed: string[] = [];

    for (const [index, proposal] of chosen.entries()) {
      setProgress({ done: index, total: chosen.length });

      try {
        // Through the public API, one record at a time: each delete is its own
        // atomic statement, and this page is no more privileged than a curl.
        const response = await fetch(
          `/api/memory/proposals/${proposal.id}/delete`,
          { method: "POST" },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(body.error ?? `${response.status} ${response.statusText}`);
        }

        setItems((current) =>
          current.filter((item) => item.id !== proposal.id),
        );
        setSelected((current) => {
          const next = new Set(current);
          next.delete(proposal.id);
          return next;
        });
      } catch (cause) {
        failed.push(
          `${proposal.title}: ${cause instanceof Error ? cause.message : "request failed"}`,
        );
      }
    }

    setProgress(null);
    setConfirming(false);
    if (failed.length > 0) setError(failed.join(" \u00B7 "));
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <div className="border-2 border-dashed border-rule bg-paper-raised p-12 text-center">
        <p className="font-display text-2xl italic text-ink-soft">
          The record is empty.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-faint">
          Nothing has been decided yet — approve or reject a proposal first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error !== null && (
        <p
          role="alert"
          className="border-2 border-stamp-red bg-paper-raised px-4 py-3 font-mono text-xs leading-relaxed text-stamp-red"
        >
          {error}
        </p>
      )}

      <div className="space-y-3">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(new Set());
            setConfirming(false);
          }}
          placeholder="Search title, content, project..."
          aria-label="Search decided memories"
          className="w-full border border-ink/20 bg-paper-raised px-3.5 py-2.5 font-mono text-xs text-ink transition-colors placeholder:text-ink-faint focus:border-ink"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={toggleAll}
            disabled={visible.length === 0 || busy}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft underline decoration-dotted decoration-rule underline-offset-4 transition-colors hover:text-ink hover:decoration-ink disabled:opacity-40"
          >
            {allSelected ? "Deselect all" : `Select all (${visible.length})`}
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={removeSelected}
                  className="border-2 border-stamp-red bg-stamp-red px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-paper-raised transition-colors disabled:opacity-40"
                >
                  {progress !== null
                    ? `Deleting ${progress.done + 1} of ${progress.total}...`
                    : `Confirm — delete ${chosen.length} permanently`}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className="border-2 border-ink/20 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={chosen.length === 0}
                onClick={() => setConfirming(true)}
                className="border-2 border-stamp-red px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-stamp-red transition-colors hover:enabled:bg-stamp-red hover:enabled:text-paper-raised disabled:opacity-40"
              >
                Delete selected ({chosen.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="border-2 border-dashed border-rule bg-paper-raised p-12 text-center">
          <p className="font-display text-2xl italic text-ink-soft">
            No matches.
          </p>
          <p className="mt-2 font-mono text-xs text-ink-faint">
            Nothing decided matches that search.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-rule border border-ink/20 bg-paper-raised shadow-[5px_5px_0_0_var(--rule)]">
          {visible.map((proposal) => {
            const mark = MARKS[statusOf(proposal)];

            return (
              <li key={proposal.id}>
                <label className="flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-paper-deep/50">
                  <input
                    type="checkbox"
                    checked={selected.has(proposal.id)}
                    onChange={() => toggle(proposal.id)}
                    aria-label={`Select ${proposal.title}`}
                    className="mt-1 size-4 shrink-0 accent-stamp-red"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
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
                    </span>
                    <span className="mt-2 block font-display text-[15px] font-medium leading-snug">
                      {proposal.title}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="font-mono text-[11px] text-ink-faint">
        {items.length} decided {items.length === 1 ? "record" : "records"}
      </p>
    </div>
  );
}
