"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChapterListItem, ReadingProgress } from "@read/api-client";
import { estimateMinutes } from "@/lib/format";
import { pickNewerProgress, readLocalProgress } from "@/lib/reading-progress";

export function BookChapterList({
  bookId,
  chapters,
  owned,
  priceCents,
  serverProgress,
}: {
  bookId: string;
  chapters: ChapterListItem[];
  owned: boolean;
  priceCents: number;
  serverProgress?: ReadingProgress | null;
}) {
  const [resumeId, setResumeId] = useState<string | null>(
    serverProgress && !serverProgress.completed_at ? serverProgress.chapter_id : null
  );

  useEffect(() => {
    const local = readLocalProgress(bookId);
    const resolved = pickNewerProgress(serverProgress, local);
    setResumeId(resolved && !resolved.completedAt ? resolved.chapterId : null);
  }, [bookId, serverProgress]);

  return (
    <ol className="mt-4 divide-y divide-[var(--line)]">
      {chapters.map((chapter) => {
        const locked = !owned && priceCents > 0 && chapter.group_index > 1;
        const isResume = chapter.id === resumeId;
        return (
          <li
            key={chapter.id}
            className={`flex items-center justify-between gap-4 py-3 ${
              isResume ? "rounded-md bg-[rgba(63,111,92,0.08)] px-2 -mx-2" : ""
            }`}
          >
            {locked ? (
              <div className="min-w-0">
                <p className="truncate text-[var(--ink)]">{chapter.title}</p>
                <p className="text-xs text-[var(--ink-soft)]">Locked · purchase to read</p>
              </div>
            ) : (
              <Link
                href={`/read/${bookId}/${chapter.id}`}
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
  );
}
