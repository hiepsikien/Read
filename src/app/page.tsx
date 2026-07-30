import { BookCard } from "@/components/BookCard";
import { listPublishedBooks } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const books = listPublishedBooks() as Array<{
    id: string;
    title: string;
    description: string;
    price_cents: number;
    publisher_name: string;
    chapter_count: number;
  }>;

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -left-10 top-8 h-40 w-40 rounded-full bg-[rgba(63,111,92,0.15)] blur-3xl ambient-orb" />
      <section className="fade-up relative overflow-hidden pb-10 pt-4 sm:pb-14 sm:pt-8">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--sage)]">In-app reading</p>
        <h1 className="brand-mark mt-3 max-w-3xl text-5xl font-semibold leading-[0.95] text-[var(--ink)] sm:text-7xl">
          Read
        </h1>
        <p className="fade-up-delay mt-5 max-w-xl text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
          A calm place for books — free titles open instantly, paid ones unlock after purchase.
          Everything stays inside the app.
        </p>
      </section>

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
          books.map((book) => <BookCard key={book.id} {...book} />)
        )}
      </section>
    </div>
  );
}
