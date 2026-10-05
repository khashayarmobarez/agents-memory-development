"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setDenied(false);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (response.status === 401) {
        setDenied(true);
        return;
      }
      if (!response.ok) {
        throw new Error(body.error ?? `${response.status} ${response.statusText}`);
      }

      router.push(next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <label
          htmlFor="password"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setDenied(false);
          }}
          autoFocus
          autoComplete="current-password"
          required
          className="mt-2 w-full border border-ink/20 bg-paper-raised px-3.5 py-3 font-mono text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-ink"
        />
      </div>

      {denied && (
        <div className="flex flex-wrap items-center gap-4">
          <span className="stamp border-2 border-stamp-red px-3 py-1 font-mono text-lg font-semibold uppercase tracking-[0.3em] text-stamp-red ring-1 ring-stamp-red ring-offset-2 ring-offset-paper">
            Denied
          </span>
          <p className="font-mono text-xs text-ink-faint">
            Wrong password. The desk stays closed.
          </p>
        </div>
      )}

      {error !== null && (
        <p
          role="alert"
          className="border-2 border-stamp-red bg-paper-raised px-4 py-3 font-mono text-xs leading-relaxed text-stamp-red"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password === ""}
        className="w-full border-2 border-stamp-green bg-stamp-green px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-paper-raised transition-all hover:enabled:-translate-y-px hover:enabled:shadow-[3px_3px_0_0_var(--ink)] active:enabled:scale-[0.99] disabled:opacity-40"
      >
        {busy ? "Checking..." : "Unlock the desk"}
      </button>
    </form>
  );
}
