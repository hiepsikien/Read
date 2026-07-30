"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, normalizeHandle, validateHandleInput } from "@read/api-client";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi } from "@/lib/api";

export default function ClaimHandlePage() {
  const router = useRouter();
  const { user, loading, setSession, logout } = useAuth();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.handle) {
      router.replace("/");
    }
  }, [loading, user, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateHandleInput(handle);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await createBrowserApi().claimHandle(normalizeHandle(handle));
      setSession(data.user);
      router.replace(data.user.role === "publisher" ? "/publisher" : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not claim handle.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user || user.handle) {
    return <p className="text-[var(--ink-soft)]">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-md fade-up">
      <p className="text-xs uppercase tracking-[0.18em] text-[var(--sage)]">Almost done</p>
      <h1 className="brand-mark mt-2 text-4xl font-semibold text-[var(--ink)]">Choose your @handle</h1>
      <p className="mt-3 text-[var(--ink-soft)]">
        Your public page will live at <span className="font-medium text-[var(--ink)]">/@handle</span>.
        This cannot be changed later.
      </p>

      <form onSubmit={onSubmit} className="surface mt-6 space-y-4 rounded-2xl p-6">
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Handle</span>
          <div className="flex items-center rounded-lg border border-[var(--line)] bg-white/70 focus-within:ring-2 focus-within:ring-[var(--sage)]">
            <span className="pl-3 text-[var(--ink-soft)]">@</span>
            <input
              className="w-full bg-transparent px-2 py-2.5 outline-none"
              value={handle}
              onChange={(e) => setHandle(normalizeHandle(e.target.value))}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={3}
              maxLength={30}
              pattern="[a-z0-9_]{3,30}"
              placeholder="yourname"
            />
          </div>
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--sage)] px-4 py-2.5 font-medium text-white transition hover:bg-[var(--sage-deep)] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Claim handle"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => void logout().then(() => router.replace("/login"))}
        className="mt-6 text-sm text-[var(--ink-soft)] underline decoration-[var(--sage)] underline-offset-4"
      >
        Sign out
      </button>
    </div>
  );
}
