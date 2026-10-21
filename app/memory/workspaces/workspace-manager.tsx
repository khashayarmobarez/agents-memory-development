"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Workspace } from "@/lib/types";

export default function WorkspaceManager({ initial }: { initial: Workspace[] }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initial);
  const [idDraft, setIdDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const id = idDraft.trim();
    const title = titleDraft.trim();
    if (id === "" || title === "") return;

    setBusy(true);
    setError(null);
    try {
      // Writes go through the public API — this page is no more privileged
      // than any other client.
      const response = await fetch("/api/memory/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        workspace?: Workspace;
      };

      if (!response.ok) {
        throw new Error(body.error ?? `${response.status} ${response.statusText}`);
      }

      setWorkspaces((current) => [...current, body.workspace ?? { id, title }]);
      setIdDraft("");
      setTitleDraft("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string) {
    const title = editingTitle.trim();
    if (title === "") return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/memory/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? `${response.status} ${response.statusText}`);
      }

      setWorkspaces((current) =>
        current.map((workspace) =>
          workspace.id === id ? { ...workspace, title } : workspace,
        ),
      );
      setEditingId(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request failed");
    } finally {
      setBusy(false);
    }
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

      <div className="border border-ink/20 bg-paper-raised p-5 shadow-[5px_5px_0_0_var(--rule)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">
          New workspace
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={idDraft}
            onChange={(event) => setIdDraft(event.target.value)}
            placeholder="id — e.g. rahyab-company"
            aria-label="Workspace id"
            className="w-full border border-ink/25 bg-paper-deep px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
          />
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder="title — e.g. Rahyab"
            aria-label="Workspace title"
            className="w-full border border-ink/25 bg-paper-deep px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
          />
          <button
            type="button"
            onClick={create}
            disabled={busy || idDraft.trim() === "" || titleDraft.trim() === ""}
            className="shrink-0 border border-ink bg-ink px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-paper-raised transition-all hover:enabled:-translate-y-px hover:enabled:shadow-[3px_3px_0_0_var(--rule)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving\u2026" : "Create"}
          </button>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <div className="border-2 border-dashed border-rule bg-paper-raised p-12 text-center">
          <p className="font-display text-2xl italic text-ink-soft">
            No workspaces yet.
          </p>
          <p className="mt-2 font-mono text-xs text-ink-faint">
            The first approved proposal creates one — or create one above.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-rule border border-ink/20 bg-paper-raised shadow-[5px_5px_0_0_var(--rule)]">
          {workspaces.map((workspace) => {
            const isEditing = editingId === workspace.id;
            const name = workspace.title ?? workspace.id;

            return (
              <li key={workspace.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-[15px] font-semibold">
                    {name}
                  </span>
                  <span className="font-mono text-xs text-ink-faint">
                    {workspace.id}
                  </span>

                  <span className="ml-auto flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <input
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          aria-label={`Rename ${workspace.id}`}
                          className="border border-ink/25 bg-paper-deep px-2.5 py-1.5 font-mono text-xs text-ink focus:border-ink focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={busy || editingTitle.trim() === ""}
                          onClick={() => rename(workspace.id)}
                          className="border border-ink bg-ink px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-paper-raised transition-colors disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                          className="border border-ink/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(workspace.id);
                          setEditingTitle(workspace.title ?? "");
                        }}
                        className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft underline decoration-dotted decoration-rule underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                      >
                        Rename
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
