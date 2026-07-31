import * as SecureStore from "expo-secure-store";

export type LocalReadingProgress = {
  chapterId: string;
  paragraphIndex: number;
  scrollFraction: number;
};

export function localProgressKey(bookId: string) {
  return `read_pos_${bookId}`;
}

export async function readLocalProgress(
  bookId: string
): Promise<LocalReadingProgress | null> {
  try {
    const raw = await SecureStore.getItemAsync(localProgressKey(bookId));
    if (!raw) return null;
    // Legacy format stored a bare chapter id string.
    if (!raw.startsWith("{")) {
      return { chapterId: raw, paragraphIndex: 0, scrollFraction: 0 };
    }
    const parsed = JSON.parse(raw) as Partial<LocalReadingProgress>;
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
    };
  } catch {
    return null;
  }
}

export async function writeLocalProgress(
  bookId: string,
  progress: LocalReadingProgress
) {
  const payload: LocalReadingProgress = {
    chapterId: progress.chapterId,
    paragraphIndex: Math.max(0, Math.floor(progress.paragraphIndex)),
    scrollFraction: Math.min(1, Math.max(0, progress.scrollFraction)),
  };
  await SecureStore.setItemAsync(localProgressKey(bookId), JSON.stringify(payload));
}
