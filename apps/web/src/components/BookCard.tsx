import Link from "next/link";
import { displayAuthorName, formatEpisodeCode, publisherIsDistinct } from "@read/api-client";
import { formatPrice } from "@/lib/format";

export function BookCard({
  id,
  title,
  description,
  price_cents,
  publisher_name,
  publisher_handle,
  author_name,
  chapter_count,
  series,
  season_number,
  episode_number,
}: {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  publisher_name: string;
  publisher_handle?: string | null;
  author_name?: string | null;
  chapter_count: number;
  series?: { id: string; title: string } | null;
  season_number?: number | null;
  episode_number?: number | null;
}) {
  const isFree = price_cents <= 0;
  const code = formatEpisodeCode(season_number, episode_number);
  const author = displayAuthorName({ author_name, publisher_name }) || publisher_name;
  const linkPublisher = Boolean(publisher_handle && !publisherIsDistinct({ author_name, publisher_name }));

  return (
    <article className="group border-b border-[var(--line)] py-6 transition first:pt-0 last:border-b-0 hover:opacity-95">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          {series ? (
            <Link
              href={`/series/${series.id}`}
              className="text-xs uppercase tracking-[0.14em] text-[var(--sage)] underline-offset-4 hover:underline"
            >
              {series.title}
              {code ? ` · ${code}` : ""}
            </Link>
          ) : linkPublisher ? (
            <Link
              href={`/@${publisher_handle}`}
              className="text-xs uppercase tracking-[0.14em] text-[var(--sage)] underline-offset-4 hover:underline"
            >
              {author}
            </Link>
          ) : (
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--sage)]">{author}</p>
          )}
          <Link href={`/books/${id}`} className="block">
            <h2 className="brand-mark mt-1 text-2xl font-semibold leading-tight text-[var(--ink)] sm:text-3xl">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--ink-soft)]">
              {description}
            </p>
          </Link>
        </div>
        <Link
          href={`/books/${id}`}
          className="flex shrink-0 items-center gap-3 text-sm text-[var(--ink-soft)]"
        >
          <span>
            {chapter_count} chapter{chapter_count === 1 ? "" : "s"}
          </span>
          <span
            className={
              isFree
                ? "font-semibold text-[var(--sage-deep)]"
                : "font-semibold text-[var(--ink)]"
            }
          >
            {formatPrice(price_cents)}
          </span>
          <span className="text-[var(--sage)] transition group-hover:translate-x-0.5">
            Read →
          </span>
        </Link>
      </div>
    </article>
  );
}
