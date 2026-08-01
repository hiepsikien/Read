"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BookListItem, SeriesListItem } from "@read/api-client";
import { ApiError } from "@read/api-client";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export default function PublisherPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [series, setSeries] = useState<SeriesListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "publisher") {
      router.replace("/");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const api = createBrowserApi();
        const [bookData, seriesData] = await Promise.all([
          api.listBooks({ mine: true }),
          api.listSeries({ mine: true }),
        ]);
        if (!cancelled) {
          setBooks(bookData.books);
          setSeries(seriesData.series);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load books.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, router]);

  if (authLoading || loading) {
    return <p className="text-[var(--ink-soft)]">Loading…</p>;
  }

  if (error) {
    return <p className="text-red-700">{error}</p>;
  }

  return (
    <div className="fade-up">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--sage)]">Publisher</p>
          <h1 className="brand-mark mt-2 text-4xl font-semibold text-[var(--ink)]">Series &amp; episodes</h1>
          <p className="mt-2 max-w-xl text-[var(--ink-soft)]">
            Manage series first, then upload and attach DOCX episodes for in-app reading.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/publisher/new"
            className="inline-flex rounded-lg bg-[var(--sage)] px-4 py-2.5 font-medium text-white hover:bg-[var(--sage-deep)]"
          >
            Upload episode
          </Link>
        </div>
      </div>

      <section className="surface mt-8 rounded-2xl px-5 sm:px-7">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Series · {series.length}
          </h2>
          <Link
            href="/publisher/series/new"
            className="text-sm font-medium text-[var(--sage)] underline underline-offset-4"
          >
            New
          </Link>
        </div>
        {series.length === 0 ? (
          <p className="py-8 text-[var(--ink-soft)]">
            No series yet. Create one, then attach episodes from each book&apos;s manage page.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {series.map((item) => {
              const coverUrl = createBrowserApi().bookCoverUrl(item.cover_url, {
                cacheKey: item.updated_at,
              });
              return (
              <li key={item.id} className="flex items-center justify-between gap-3 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl}
                      alt=""
                      className="h-14 w-10 shrink-0 rounded-md border border-[var(--line)] object-cover"
                    />
                  ) : null}
                  <div>
                    <Link
                      href={`/publisher/series/${item.id}`}
                      className="brand-mark text-xl font-semibold text-[var(--ink)] hover:underline hover:decoration-[var(--sage)] hover:underline-offset-4"
                    >
                      {item.title}
                    </Link>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {item.episode_count} episode
                      {item.episode_count === 1 ? "" : "s"}
                      {item.visibility === "hidden" ? " · Hidden" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/publisher/series/${item.id}`}
                    className="rounded-lg border border-[var(--line)] bg-white/50 px-3 py-2 text-sm"
                  >
                    Manage
                  </Link>
                  <Link
                    href={`/series/${item.id}`}
                    className="rounded-lg border border-[var(--line)] bg-white/50 px-3 py-2 text-sm"
                  >
                    View
                  </Link>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="surface mt-8 rounded-2xl px-5 sm:px-7">
        <div className="border-b border-[var(--line)] py-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Your books · {books.length}
          </h2>
        </div>
        {books.length === 0 ? (
          <p className="py-10 text-[var(--ink-soft)]">No books yet. Upload your first manuscript.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {books.map((book) => (
              <li key={book.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/publisher/${book.id}`}
                    className="brand-mark text-2xl font-semibold text-[var(--ink)] hover:underline hover:decoration-[var(--sage)] hover:underline-offset-4"
                  >
                    {book.title}
                  </Link>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {book.status} · {book.chapter_count} chapters · {formatPrice(book.price_cents)}
                    {book.series
                      ? ` · S${book.season_number}E${book.episode_number} · ${book.series.title}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/publisher/${book.id}`}
                    className="rounded-lg border border-[var(--line)] bg-white/50 px-3 py-2 text-sm"
                  >
                    Manage
                  </Link>
                  {book.status === "published" && book.chapter_count > 0 && (
                    <Link
                      href={`/books/${book.id}`}
                      className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm text-[var(--paper)]"
                    >
                      View
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
