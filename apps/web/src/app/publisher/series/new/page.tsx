"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError } from "@read/api-client";
import { createBrowserApi } from "@/lib/api";

export default function NewSeriesPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await createBrowserApi().createSeries({
        title: title.trim(),
        description: description.trim(),
      });
      router.replace(`/publisher?series=${payload.series.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create series.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up mx-auto max-w-xl">
      <Link href="/publisher" className="text-sm text-[var(--ink-soft)] underline underline-offset-4">
        ← Publisher home
      </Link>
      <h1 className="brand-mark mt-6 text-4xl font-semibold text-[var(--ink)]">New series</h1>
      <p className="mt-2 text-[var(--ink-soft)]">
        Group episode books by season. Each book stays a purchasable episode.
      </p>

      <form onSubmit={onSubmit} className="surface mt-8 space-y-4 rounded-2xl p-6">
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Title</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-lg bg-[var(--sage)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--sage-deep)] disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create series"}
        </button>
      </form>
    </div>
  );
}
