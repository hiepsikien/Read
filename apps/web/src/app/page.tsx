import Link from "next/link";
import type { ReadingShelfItem, SeriesContinueItem, SeriesListItem } from "@read/api-client";
import { formatEpisodeCode } from "@read/api-client";
import { BookCard } from "@/components/BookCard";
import { createServerApi } from "@/lib/api-server";
import { formatPrice } from "@/lib/format";
import { formatProgressLabel } from "@/lib/reading-progress";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const api = await createServerApi();
  const [{ books }, seriesPayload] = await Promise.all([
    api.listBooks(),
    api.listSeries().catch(() => ({ series: [] as SeriesListItem[] })),
  ]);
  const seriesList = seriesPayload.series;

  let continueItems: ReadingShelfItem[] = [];
  let seriesContinue: SeriesContinueItem[] = [];
  try {
    const reading = await api.listReading();
    const seen = new Set<string>();
    continueItems = reading.items.filter((item) => {
      if (seen.has(item.book.id)) return false;
      seen.add(item.book.id);
      return true;
    });
    seriesContinue = reading.series_continue || [];
  } catch {
    continueItems = [];
    seriesContinue = [];
  }

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -left-10 top-8 h-40 w-40 rounded-full bg-[rgba(63,111,92,0.15)] blur-3xl ambient-orb" />
      <section className="fade-up relative overflow-hidden pb-10 pt-4 sm:pb-14 sm:pt-8">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--sage)]">In-app reading</p>
        <div className="mt-5 overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/read-wordmark-hero.png"
            alt="Read"
            className="h-auto w-full max-w-xl object-cover object-center sm:max-w-2xl"
          />
        </div>
        <p className="fade-up-delay mt-5 max-w-xl text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
          A calm place for books — free titles open instantly, paid ones unlock after purchase.
          Everything stays inside the app.
        </p>
      </section>

      {continueItems.length > 0 ? (
        <section className="surface fade-up mb-8 rounded-2xl px-5 py-2 sm:px-8">
          <div className="border-b border-[var(--line)] py-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
              Continue reading
            </h2>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {continueItems.map((item) => {
              const code = formatEpisodeCode(item.book.season_number, item.book.episode_number);
              return (
                <li key={item.book.id} className="flex items-center justify-between gap-4 py-5">
                  <div className="min-w-0">
                    {item.book.series ? (
                      <Link
                        href={`/series/${item.book.series.id}`}
                        className="text-xs uppercase tracking-[0.14em] text-[var(--sage)] hover:underline"
                      >
                        {item.book.series.title}
                        {code ? ` · ${code}` : ""}
                      </Link>
                    ) : null}
                    <Link
                      href={`/read/${item.book.id}/${item.progress.chapter_id}`}
                      className="brand-mark mt-1 block text-xl font-semibold text-[var(--ink)] hover:underline"
                    >
                      {item.book.title}
                    </Link>
                    <p className="mt-1 text-xs font-medium text-[var(--sage-deep)]">
                      {formatProgressLabel(
                        item.progress.chapter_position,
                        item.progress.chapter_count,
                        item.progress.scroll_fraction
                      )}
                      {" · "}
                      {item.progress.chapter_title}
                    </p>
                  </div>
                  <Link
                    href={`/read/${item.book.id}/${item.progress.chapter_id}`}
                    className="shrink-0 text-sm text-[var(--sage)]"
                  >
                    Resume →
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {seriesContinue.length > 0 ? (
        <section className="surface fade-up mb-8 rounded-2xl px-5 py-2 sm:px-8">
          <div className="border-b border-[var(--line)] py-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
              Continue series
            </h2>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {seriesContinue.map((item) => (
              <li key={item.book.id} className="flex items-center justify-between gap-4 py-5">
                <div className="min-w-0">
                  {item.series ? (
                    <Link
                      href={`/series/${item.series.id}`}
                      className="text-xs uppercase tracking-[0.14em] text-[var(--sage)] hover:underline"
                    >
                      {item.series.title}
                      {item.episode_code ? ` · ${item.episode_code}` : ""}
                    </Link>
                  ) : null}
                  <Link
                    href={`/books/${item.book.id}`}
                    className="brand-mark mt-1 block text-xl font-semibold text-[var(--ink)] hover:underline"
                  >
                    {item.book.title}
                  </Link>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    {item.owned
                      ? "Next episode ready"
                      : `Unlock · ${formatPrice(item.book.price_cents)}`}
                  </p>
                </div>
                <Link href={`/books/${item.book.id}`} className="shrink-0 text-sm text-[var(--sage)]">
                  {item.owned ? "Continue →" : "View →"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {seriesList.length > 0 ? (
        <section className="surface fade-up mb-8 rounded-2xl px-5 py-2 sm:px-8">
          <div className="border-b border-[var(--line)] py-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
              Series
            </h2>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {seriesList.map((item) => {
              const coverUrl = api.bookCoverUrl(item.cover_url, { cacheKey: item.updated_at });
              return (
              <li key={item.id} className="flex items-center justify-between gap-4 py-5">
                <div className="flex min-w-0 items-center gap-4">
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl}
                      alt=""
                      className="h-16 w-12 shrink-0 rounded-md border border-[var(--line)] object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-12 shrink-0 items-end rounded-md border border-[var(--line)] bg-[var(--mist)] p-1.5">
                      <span className="line-clamp-3 text-[10px] font-semibold leading-tight text-[var(--ink)]">
                        {item.title}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <Link
                      href={`/series/${item.id}`}
                      className="brand-mark text-xl font-semibold text-[var(--ink)] hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {item.episode_count} episode{item.episode_count === 1 ? "" : "s"}
                      {item.publisher_name ? ` · ${item.publisher_name}` : ""}
                    </p>
                  </div>
                </div>
                <Link href={`/series/${item.id}`} className="shrink-0 text-sm text-[var(--sage)]">
                  Browse →
                </Link>
              </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="surface fade-up rounded-2xl px-5 py-2 sm:px-8">
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Library
          </h2>
          <p className="text-sm text-[var(--ink-soft)]">{books.length} titles</p>
        </div>
        {books.length === 0 ? (
          <p className="py-10 text-[var(--ink-soft)]">No published books yet.</p>
        ) : (
          books.map((book) => (
            <BookCard
              key={book.id}
              id={book.id}
              title={book.title}
              description={book.description}
              price_cents={book.price_cents}
              publisher_name={book.publisher_name || "Publisher"}
              publisher_handle={book.publisher_handle}
              chapter_count={book.chapter_count}
              series={book.series}
              season_number={book.season_number}
              episode_number={book.episode_number}
            />
          ))
        )}
      </section>
    </div>
  );
}
