import Link from "next/link";
import { notFound } from "next/navigation";
import {
  displayAuthorName,
  publisherIsDistinct,
  sourceCreditLine,
  translatorCreditLine,
  type BookListItem,
} from "@read/api-client";
import { BookCard } from "@/components/BookCard";
import { BookChapterList } from "@/components/BookChapterList";
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
          author_name={item.author_name}
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
    .catch(() => ({
      next_episode: null as BookListItem | null,
      same_author: [] as BookListItem[],
      related: [] as BookListItem[],
    }));

  const { book, chapters, access } = payload;
  const owned = access.owned;
  const isOwner = access.isPublisherOwner;
  const firstChapter = chapters[0];
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.word_count, 0);
  const nextEpisode = book.next_episode || recommendations.next_episode;
  const author = displayAuthorName(book) || book.publisher_name;
  const translatorLine = translatorCreditLine(book);
  const sourceLine = sourceCreditLine(book);
  const showPublisher = publisherIsDistinct(book);

  return (
    <div className="fade-up mx-auto max-w-3xl">
      <Link
        href="/"
        className="text-sm text-[var(--ink-soft)] underline decoration-[var(--sage)] underline-offset-4"
      >
        ← Library
      </Link>

      {book.series ? (
        <Link
          href={`/series/${book.series.id}`}
          className="mt-8 block text-xs uppercase tracking-[0.18em] text-[var(--sage)] underline-offset-4 hover:underline"
        >
          {book.series.title}
          {book.season_number != null && book.episode_number != null
            ? ` · S${book.season_number}E${book.episode_number}`
            : ""}
        </Link>
      ) : !showPublisher && book.publisher_handle ? (
        <Link
          href={`/@${book.publisher_handle}`}
          className="mt-8 text-xs uppercase tracking-[0.18em] text-[var(--sage)] underline-offset-4 hover:underline"
        >
          {author}
        </Link>
      ) : (
        <p className="mt-8 text-xs uppercase tracking-[0.18em] text-[var(--sage)]">
          {author}
          {translatorLine ? ` · ${translatorLine}` : ""}
        </p>
      )}
      {!book.series && !showPublisher && translatorLine ? (
        <p className="mt-2 text-xs text-[var(--ink-soft)]">{translatorLine}</p>
      ) : null}
      {book.series ? (
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--sage)]">
          {author}
          {translatorLine ? ` · ${translatorLine}` : ""}
        </p>
      ) : null}
      {showPublisher && book.publisher_handle ? (
        <Link
          href={`/@${book.publisher_handle}`}
          className="mt-2 block text-xs text-[var(--ink-soft)] underline-offset-4 hover:underline"
        >
          Xuất bản bởi {book.publisher_name}
        </Link>
      ) : showPublisher ? (
        <p className="mt-2 text-xs text-[var(--ink-soft)]">Xuất bản bởi {book.publisher_name}</p>
      ) : null}
      {sourceLine ? <p className="mt-2 text-xs text-[var(--ink-soft)]">{sourceLine}</p> : null}
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
            chapters={chapters}
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
        {nextEpisode ? (
          <Link
            href={`/books/${nextEpisode.id}`}
            className="rounded-lg border border-[var(--line)] bg-white/60 px-5 py-2.5 text-[var(--ink)]"
          >
            Next episode
            {nextEpisode.season_number != null && nextEpisode.episode_number != null
              ? ` · S${nextEpisode.season_number}E${nextEpisode.episode_number}`
              : ""}
          </Link>
        ) : null}
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
        <BookChapterList
          bookId={book.id}
          chapters={chapters}
          owned={owned}
          priceCents={book.price_cents}
          serverProgress={access.progress}
        />
      </section>

      <RecommendationSection title="More by this author" books={recommendations.same_author} />
      <RecommendationSection title="Related" books={recommendations.related} />
    </div>
  );
}
