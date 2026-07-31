import Link from "next/link";
import { notFound } from "next/navigation";
import type { BookListItem } from "@read/api-client";
import { BookCard } from "@/components/BookCard";
import { ContinueReadingButton } from "@/components/ContinueReadingButton";
import { PurchaseButton } from "@/components/PurchaseButton";
import { createServerApi } from "@/lib/api-server";
import { estimateMinutes, formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

function RecommendationSection({
  title,
  books,
}: {
  title: string;
  books: BookListItem[];
}) {
  if (books.length === 0) return null;
  return (
    <section className="surface mt-10 rounded-2xl px-5 py-2 sm:px-7">
      <div className="border-b border-[var(--line)] py-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          {title}
        </h2>
      </div>
      {books.map((item) => (
        <BookCard
          key={item.id}
          id={item.id}
          title={item.title}
          description={item.description}
          price_cents={item.price_cents}
          publisher_name={item.publisher_name || "Publisher"}
          publisher_handle={item.publisher_handle}
          chapter_count={item.chapter_count}
        />
      ))}
    </section>
  );
}

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  const api = await createServerApi();

  let payload;
  try {
    payload = await api.getBook(id);
  } catch {
    notFound();
  }

  const recommendations = await api
    .getBookRecommendations(id)
    .catch(() => ({ same_author: [] as BookListItem[], related: [] as BookListItem[] }));

  const { book, chapters, access } = payload;
  const owned = access.owned;
  const isOwner = access.isPublisherOwner;
  const firstChapter = chapters[0];
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.word_count, 0);

  return (
    <div className="fade-up mx-auto max-w-3xl">
      <Link
        href="/"
        className="text-sm text-[var(--ink-soft)] underline decoration-[var(--sage)] underline-offset-4"
      >
        ← Library
      </Link>

      {book.publisher_handle ? (
        <Link
          href={`/@${book.publisher_handle}`}
          className="mt-8 text-xs uppercase tracking-[0.18em] text-[var(--sage)] underline-offset-4 hover:underline"
        >
          {book.publisher_name}
        </Link>
      ) : (
        <p className="mt-8 text-xs uppercase tracking-[0.18em] text-[var(--sage)]">
          {book.publisher_name}
        </p>
      )}
      <h1 className="brand-mark mt-3 text-4xl font-semibold leading-tight text-[var(--ink)] sm:text-5xl">
        {book.title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-[var(--ink-soft)]">{book.description}</p>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--ink-soft)]">
        <span>{formatPrice(book.price_cents)}</span>
        <span>
          {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
        </span>
        <span>~{estimateMinutes(totalWords)} min</span>
        {book.status === "draft" && <span className="text-amber-800">Draft</span>}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {firstChapter && (
          <ContinueReadingButton
            bookId={book.id}
            firstChapterId={firstChapter.id}
            serverProgress={access.progress}
            owned={owned}
          />
        )}
        {!owned && book.price_cents > 0 && (
          <PurchaseButton bookId={book.id} priceCents={book.price_cents} />
        )}
        {isOwner && (
          <Link
            href={`/publisher/${book.id}`}
            className="rounded-lg border border-[var(--line)] bg-white/60 px-5 py-2.5 text-[var(--ink)]"
          >
            Manage book
          </Link>
        )}
      </div>

      {!owned && book.price_cents > 0 && (
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          The whole first chapter is free inside Read — every reading segment in it.
          Purchase unlocks the rest.
        </p>
      )}

      <section className="surface mt-10 rounded-2xl p-5 sm:p-7">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          Chapters
        </h2>
        <ol className="mt-4 divide-y divide-[var(--line)]">
          {chapters.map((chapter) => {
            const locked = !owned && book.price_cents > 0 && chapter.group_index > 1;
            return (
              <li key={chapter.id} className="flex items-center justify-between gap-4 py-3">
                {locked ? (
                  <div className="min-w-0">
                    <p className="truncate text-[var(--ink)]">{chapter.title}</p>
                    <p className="text-xs text-[var(--ink-soft)]">Locked · purchase to read</p>
                  </div>
                ) : (
                  <Link
                    href={`/read/${book.id}/${chapter.id}`}
                    className="min-w-0 truncate text-[var(--ink)] underline decoration-transparent underline-offset-4 transition hover:decoration-[var(--sage)]"
                  >
                    {chapter.title}
                  </Link>
                )}
                <span className="shrink-0 text-xs text-[var(--ink-soft)]">
                  {estimateMinutes(chapter.word_count)} min
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <RecommendationSection title="More by this author" books={recommendations.same_author} />
      <RecommendationSection title="Related" books={recommendations.related} />
    </div>
  );
}
