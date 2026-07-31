export type LocalReadingProgress = {
  chapterId: string;
  paragraphIndex: number;
  scrollFraction: number;
  at: number;
};

export function localProgressKey(bookId: string) {
  return `read:pos:${bookId}`;
}

export function readLocalProgress(bookId: string): LocalReadingProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(localProgressKey(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalReadingProgress> & {
      chapterId?: string;
    };
    if (typeof parsed.chapterId !== "string" || !parsed.chapterId) return null;
    return {
      chapterId: parsed.chapterId,
      paragraphIndex:
        typeof parsed.paragraphIndex === "number" && parsed.paragraphIndex >= 0
          ? Math.floor(parsed.paragraphIndex)
          : 0,
      scrollFraction:
        typeof parsed.scrollFraction === "number"
          ? Math.min(1, Math.max(0, parsed.scrollFraction))
          : 0,
      at: typeof parsed.at === "number" ? parsed.at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeLocalProgress(
  bookId: string,
  progress: Omit<LocalReadingProgress, "at"> & { at?: number }
) {
  if (typeof window === "undefined") return;
  const payload: LocalReadingProgress = {
    chapterId: progress.chapterId,
    paragraphIndex: Math.max(0, Math.floor(progress.paragraphIndex)),
    scrollFraction: Math.min(1, Math.max(0, progress.scrollFraction)),
    at: progress.at ?? Date.now(),
  };
  window.localStorage.setItem(localProgressKey(bookId), JSON.stringify(payload));
}

export function nearestParagraphIndex(scrollY: number): number {
  const paragraphs = Array.from(
    document.querySelectorAll<HTMLElement>("[data-read-paragraph]")
  );
  if (paragraphs.length === 0) return 0;
  const target = scrollY + 48;
  let best = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const top = paragraphs[i].offsetTop;
    if (top <= target) best = i;
    else break;
  }
  return best;
}
