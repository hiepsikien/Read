"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChapterListItem, ReadingProgress } from "@read/api-client";
import {
  formatProgressLabel,
  pickNewerProgress,
  readLocalProgress,
} from "@/lib/reading-progress";

export function ContinueReadingButton({
  bookId,
  firstChapterId,
  serverProgress,
  owned,
  chapters,
}: {
  bookId: string;
  firstChapterId: string;
  serverProgress?: ReadingProgress | null;
  owned: boolean;
  chapters: ChapterListItem[];
}) {
  const [chapterId, setChapterId] = useState(firstChapterId);
  const [hasProgress, setHasProgress] = useState(false);
  const [subtitle, setSubtitle] = useState<string | null>(null);

  useEffect(() => {
    const local = readLocalProgress(bookId);
    const resolved = pickNewerProgress(serverProgress, local);
    if (resolved && !resolved.completedAt) {
      setChapterId(resolved.chapterId);
      setHasProgress(true);
      const chapter = chapters.find((c) => c.id === resolved.chapterId);
      if (chapter) {
        setSubtitle(
          formatProgressLabel(chapter.position, chapters.length, resolved.scrollFraction)
        );
      } else {
        setSubtitle(null);
      }
      return;
    }
    setChapterId(firstChapterId);
    setHasProgress(false);
    setSubtitle(null);
  }, [bookId, firstChapterId, serverProgress, chapters]);

  const label = hasProgress
    ? "Continue reading"
    : owned
      ? "Start reading"
      : "Read chapter 1 free";

  return (
    <div className="flex flex-col gap-1">
      <Link
        href={`/read/${bookId}/${chapterId}`}
        className="inline-flex rounded-lg bg-[var(--sage)] px-5 py-2.5 font-medium text-white transition hover:bg-[var(--sage-deep)]"
      >
        {label}
      </Link>
      {subtitle ? (
        <p className="text-xs font-medium text-[var(--sage-deep)]">{subtitle}</p>
      ) : null}
    </div>
  );
}
