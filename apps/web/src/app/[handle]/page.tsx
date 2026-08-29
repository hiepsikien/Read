import Link from "next/link";
import { notFound } from "next/navigation";
import { isHubPublisherProfile } from "@read/api-client";
import { BookCard } from "@/components/BookCard";
import { createServerApi } from "@/lib/api-server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

function parseHandleParam(segment: string): string | null {
  if (!segment.startsWith("@") || segment.length < 2) return null;
  return segment.slice(1).toLowerCase();
}

export default async function PublicProfilePage({ params }: Props) {
  const { handle: segment } = await params;
  const handle = parseHandleParam(segment);
  if (!handle) notFound();

  const api = await createServerApi();
  let payload;
  try {
    payload = await api.getProfile(handle);
  } catch {
    notFound();
  }

  const { profile, books } = payload;
  const roleLabel = isHubPublisherProfile(profile)
    ? "Publisher"
    : profile.role === "publisher"
      ? "Author"
      : profile.role === "admin"
        ? "Admin"
        : "Reader";

  return (
    <div className="fade-up mx-auto max-w-3xl">
      <Link
        href="/"
        className="text-sm text-[var(--ink-soft)] underline decoration-[var(--sage)] underline-offset-4"
      >
        ← Library
      </Link>

      <p className="mt-8 text-xs uppercase tracking-[0.18em] text-[var(--sage)]">@{profile.handle}</p>
      <h1 className="brand-mark mt-3 text-4xl font-semibold leading-tight text-[var(--ink)] sm:text-5xl">
        {profile.name}
      </h1>
      <p className="mt-3 text-[var(--ink-soft)]">{roleLabel}</p>

      <section className="surface mt-10 rounded-2xl px-5 py-2 sm:px-8">
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Published books
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
              publisher_name={book.publisher_name || profile.name}
              publisher_handle={book.publisher_handle || profile.handle}
              author_name={book.author_name}
              chapter_count={book.chapter_count}
            />
          ))
        )}
      </section>
    </div>
  );
}
