"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BookListItem } from "@read/api-client";
import { ApiError } from "@read/api-client";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export default function PublisherPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
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
        const data = await createBrowserApi().listBooks(true);
        if (!cancelled) setBooks(data.books);
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
          <h1 className="brand-mark mt-2 text-4xl font-semibold text-[var(--ink)]">Your books</h1>
          <p className="mt-2 max-w-xl text-[var(--ink-soft)]">
            Upload a PDF or DOCX, auto-split into chapters, then publish for in-app reading.
          </p>
        </div>
        <Link
          href="/publisher/new"
          className="inline-flex rounded-lg bg-[var(--sage)] px-4 py-2.5 font-medium text-white hover:bg-[var(--sage-deep)]"
        >
          Upload book
        </Link>
      </div>

      <section className="surface mt-8 rounded-2xl px-5 sm:px-7">
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
