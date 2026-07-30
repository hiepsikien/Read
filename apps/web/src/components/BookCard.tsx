import Link from "next/link";
import { formatPrice } from "@/lib/format";

export function BookCard({
  id,
  title,
  description,
  price_cents,
  publisher_name,
  chapter_count,
}: {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  publisher_name: string;
  chapter_count: number;
}) {
  const isFree = price_cents <= 0;

  return (
    <Link
      href={`/books/${id}`}
      className="group block border-b border-[var(--line)] py-6 transition first:pt-0 last:border-b-0 hover:opacity-95"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--sage)]">
            {publisher_name}
          </p>
          <h2 className="brand-mark mt-1 text-2xl font-semibold leading-tight text-[var(--ink)] sm:text-3xl">
            {title}
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--ink-soft)]">
            {description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm text-[var(--ink-soft)]">
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
        </div>
      </div>
    </Link>
  );
}
