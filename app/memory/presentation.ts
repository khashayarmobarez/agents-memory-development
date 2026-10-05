import type { Proposal } from "@/lib/types";

export type DecidedStatus = "approved" | "rejected";

// Type chips read as index tabs: solid for decisions, outlined for conventions,
// faint for notes. Shared by the pending queue and the decided lists.
export const TYPE_TABS: Record<Proposal["type"], string> = {
  decision: "border-ink bg-ink text-paper-raised",
  convention: "border-ink text-ink",
  note: "border-rule text-ink-faint",
};

// Rotated mini stamps worn by decided records.
export const MARKS: Record<DecidedStatus, { text: string; className: string }> = {
  approved: {
    text: "Approved",
    className: "border-stamp-green text-stamp-green",
  },
  rejected: {
    text: "Rejected",
    className: "border-stamp-red text-stamp-red",
  },
};

// Deliberately not toLocaleString(): the pending queue renders on the server
// too, and a locale-dependent format risks a hydration mismatch.
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
