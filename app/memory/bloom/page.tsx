import Link from "next/link";

import { getBloomGraph } from "@/lib/bloom";

import SignOut from "../sign-out";
import BloomScene from "./bloom-scene";

// The scene is the live database; a cached render would be a lie.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BloomPage() {
  const graph = await getBloomGraph();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8">
      <header>
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
            Graph chamber
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
          Database bloom.
        </h1>

        <p className="mt-5 max-w-[62ch] border-l-2 border-ink pl-4 font-display text-[15px] italic leading-relaxed text-ink-soft">
          The database as it is — every node, every relationship, every stored
          value. Read-only: this chamber has glass walls. Drag the scene, roll
          to zoom, click a node to read its record.
        </p>
      </header>

      <div aria-hidden className="mt-7 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <BloomScene initial={graph} />
    </div>
  );
}
