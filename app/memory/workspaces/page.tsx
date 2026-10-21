import Link from "next/link";

import { listWorkspaces } from "@/lib/memory";

import SignOut from "../sign-out";
import WorkspaceManager from "./workspace-manager";

// Names change at the desk, so the list must never be a cached render.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function WorkspacesPage() {
  const workspaces = await listWorkspaces();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header>
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
            Folders
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
          Workspaces.
        </h1>

        <p className="mt-5 border-l-2 border-ink pl-4 font-display text-[15px] italic leading-relaxed text-ink-soft">
          The top of the graph. Every project hangs under a workspace, and the
          name you give one here is what the bloom prints under its node.
        </p>
      </header>

      <div aria-hidden className="mt-9 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <div className="mt-8">
        <WorkspaceManager initial={workspaces} />
      </div>
    </div>
  );
}
