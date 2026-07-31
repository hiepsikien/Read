"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReadingProgress } from "@read/api-client";
import { readLocalProgress } from "@/lib/reading-progress";

export function ContinueReadingButton({
  bookId,
  firstChapterId,
  serverProgress,
  owned,
}: {
  bookId: string;
  firstChapterId: string;
  serverProgress?: ReadingProgress | null;
  owned: boolean;
}) {
  const [chapterId, setChapterId] = useState(
    serverProgress?.chapter_id ?? firstChapterId
  );
  const [hasProgress, setHasProgress] = useState(Boolean(serverProgress));

  useEffect(() => {
    if (serverProgress?.chapter_id) {
      setChapterId(serverProgress.chapter_id);
      setHasProgress(true);
      return;
    }
    const local = readLocalProgress(bookId);
    if (local?.chapterId) {
      setChapterId(local.chapterId);
      setHasProgress(true);
      return;
    }
    setChapterId(firstChapterId);
    setHasProgress(false);
  }, [bookId, firstChapterId, serverProgress]);

  const label =
    hasProgress || owned ? "Continue reading" : "Read chapter 1 free";

  return (
    <Link
      href={`/read/${bookId}/${chapterId}`}
      className="rounded-lg bg-[var(--sage)] px-5 py-2.5 font-medium text-white transition hover:bg-[var(--sage-deep)]"
    >
      {label}
    </Link>
  );
}
