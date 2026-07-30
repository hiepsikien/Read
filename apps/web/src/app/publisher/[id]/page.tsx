"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, SPLIT_LENGTH_OPTIONS, type SplitLength } from "@read/api-client";
import { createBrowserApi } from "@/lib/api";
import { formatPrice } from "@/lib/format";

type BookPayload = {
  book: {
    id: string;
    title: string;
    description: string;
    price_cents: number;
    status: string;
    source_filename: string | null;
    has_raw_text: boolean;
  };
  chapters: Array<{ id: string; position: number; title: string; word_count: number }>;
};

export default function ManageBookPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<BookPayload | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [splitLength, setSplitLength] = useState<SplitLength>("standard");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const payload = await createBrowserApi().getBook(params.id);
      setData(payload);
      setTitle(payload.book.title);
      setDescription(payload.book.description);
      setPricing(payload.book.price_cents > 0 ? "paid" : "free");
      setPrice(((payload.book.price_cents || 499) / 100).toFixed(2));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load book.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function saveMeta(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setMessage("");
    setError("");
    try {
      await createBrowserApi().updateBook(params.id, {
        title,
        description,
        pricing,
        price: Number(price),
      });
      setMessage("Details saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy("");
    }
  }

  async function splitChapters() {
    setBusy("split");
    setMessage("");
    setError("");
    try {
      const payload = await createBrowserApi().splitBook(params.id, {
        length: splitLength,
      });
      setMessage(`Created ${payload.chapter_count} chapters.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Split failed.");
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    setBusy("publish");
    setMessage("");
    setError("");
    try {
      await createBrowserApi().publishBook(params.id);
      setMessage("Book published to the library.");
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed.");
    } finally {
      setBusy("");
    }
  }

  if (error && !data) {
    return <p className="text-red-700">{error}</p>;
  }

  if (!data) {
    return <p className="text-[var(--ink-soft)]">Loading book…</p>;
  }

  return (
    <div className="fade-up mx-auto max-w-2xl">
      <Link href="/publisher" className="text-sm text-[var(--ink-soft)] underline underline-offset-4">
        ← Publisher home
      </Link>

      <h1 className="brand-mark mt-6 text-4xl font-semibold text-[var(--ink)]">{data.book.title}</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        Status: {data.book.status} · {formatPrice(data.book.price_cents)}
        {data.book.source_filename ? ` · ${data.book.source_filename}` : ""}
      </p>

      <form onSubmit={saveMeta} className="surface mt-8 space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          Details
        </h2>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Title</span>
          <input
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
        <fieldset className="space-y-2">
          <legend className="text-sm text-[var(--ink-soft)]">Pricing</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={pricing === "free"}
              onChange={() => setPricing("free")}
            />
            Free
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={pricing === "paid"}
              onChange={() => setPricing("paid")}
            />
            Paid
          </label>
          {pricing === "paid" && (
            <input
              type="number"
              min="0.99"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
            />
          )}
        </fieldset>
        <button
          type="submit"
          disabled={busy === "save"}
          className="rounded-lg border border-[var(--line)] bg-white/70 px-4 py-2.5 text-sm font-medium"
        >
          {busy === "save" ? "Saving…" : "Save details"}
        </button>
      </form>

      <section className="surface mt-6 rounded-2xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          Chapters
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Detects existing chapters and sections, then packs them into comfortable
          reading segments — without cutting a section across two units. Pick how
          long each part should feel.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SPLIT_LENGTH_OPTIONS.map((option) => {
            const active = splitLength === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSplitLength(option.value)}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  active
                    ? "border-[var(--sage)] bg-[var(--sage)] text-white"
                    : "border-[var(--line)] bg-white/70 text-[var(--ink)]"
                }`}
              >
                <span className="block font-medium">{option.label}</span>
                <span className={`block text-xs ${active ? "text-white/85" : "text-[var(--ink-soft)]"}`}>
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={splitChapters}
          disabled={!data.book.has_raw_text || busy === "split"}
          className="mt-4 rounded-lg bg-[var(--sage)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--sage-deep)] disabled:opacity-50"
        >
          {busy === "split" ? "Splitting…" : "Auto-split into reading segments"}
        </button>

        <ol className="mt-5 divide-y divide-[var(--line)]">
          {data.chapters.length === 0 ? (
            <li className="py-4 text-sm text-[var(--ink-soft)]">No chapters yet.</li>
          ) : (
            data.chapters.map((chapter) => (
              <li key={chapter.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>{chapter.title}</span>
                <span className="text-[var(--ink-soft)]">{chapter.word_count} words</span>
              </li>
            ))
          )}
        </ol>
      </section>

      <section className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={publish}
          disabled={data.chapters.length === 0 || busy === "publish"}
          className="rounded-lg bg-[var(--ink)] px-4 py-2.5 text-sm font-medium text-[var(--paper)] disabled:opacity-50"
        >
          {busy === "publish" ? "Publishing…" : "Publish to library"}
        </button>
        {data.book.status === "published" && data.chapters[0] && (
          <Link
            href={`/read/${data.book.id}/${data.chapters[0].id}`}
            className="rounded-lg border border-[var(--line)] bg-white/70 px-4 py-2.5 text-sm"
          >
            Open in-app reader
          </Link>
        )}
      </section>

      {message && <p className="mt-4 text-sm text-[var(--sage-deep)]">{message}</p>}
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
    </div>
  );
}
