"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={signOut}
      className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
    >
      {busy ? "Closing..." : "Sign out"}
    </button>
  );
}
