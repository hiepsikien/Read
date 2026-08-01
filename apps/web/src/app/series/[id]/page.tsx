import Link from "next/link";
import { notFound } from "next/navigation";
import { BookCard } from "@/components/BookCard";
import { createServerApi } from "@/lib/api-server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function SeriesDetailPage({ params }: Props) {
  const { id } = await params;
  const api = await createServerApi();

  let payload;
  try {
    payload = await api.getSeries(id);
  } catch {
    notFound();
  }

  const { series, seasons } = payload;
  const coverUrl = api.bookCoverUrl(series.cover_url, { cacheKey: series.updated_at });

  return (
    <div className="fade-up mx-auto max-w-3xl">
      <Link
        href="/"
        className="text-sm text-[var(--ink-soft)] underline decoration-[var(--sage)] underline-offset-4"
      >
        ← Library
      </Link>

      <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            className="h-auto w-36 shrink-0 rounded-lg border border-[var(--line)] object-cover shadow-sm sm:w-44"
          />
        ) : (
          <div className="flex h-52 w-36 shrink-0 items-end rounded-lg border border-[var(--line)] bg-[var(--mist)] p-3 sm:w-44">
            <p className="text-sm font-semibold text-[var(--ink)]">{series.title}</p>
          </div>
        )}
        <div className="min-w-0 flex-1">
          {series.publisher_handle ? (
            <Link
              href={`/@${series.publisher_handle}`}
              className="text-xs uppercase tracking-[0.18em] text-[var(--sage)] underline-offset-4 hover:underline"
            >
              {series.publisher_name}
            </Link>
          ) : (
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--sage)]">
              {series.publisher_name || "Series"}
            </p>
          )}
          <h1 className="brand-mark mt-3 text-4xl font-semibold leading-tight text-[var(--ink)] sm:text-5xl">
            {series.title}
          </h1>
          {series.description ? (
            <p className="mt-4 text-lg leading-relaxed text-[var(--ink-soft)]">{series.description}</p>
          ) : null}
          <p className="mt-4 text-sm text-[var(--ink-soft)]">
            {series.episode_count} episode{series.episode_count === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {seasons.length === 0 ? (
        <p className="mt-10 text-[var(--ink-soft)]">No published episodes yet.</p>
      ) : (
        seasons.map((season) => (
          <section key={season.season_number} className="surface mt-10 rounded-2xl px-5 py-2 sm:px-7">
            <div className="border-b border-[var(--line)] py-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Season {season.season_number}
              </h2>
            </div>
            {season.episodes.map((item) => (
              <BookCard
                key={item.id}
                id={item.id}
                title={item.title}
                description={item.description}
                price_cents={item.price_cents}
                publisher_name={item.publisher_name || series.publisher_name || "Publisher"}
                publisher_handle={item.publisher_handle}
                chapter_count={item.chapter_count}
                series={item.series}
                season_number={item.season_number}
                episode_number={item.episode_number}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
