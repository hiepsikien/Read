import * as SecureStore from "expo-secure-store";
import type { ReadingProgress } from "@read/api-client";

export type LocalReadingProgress = {
  chapterId: string;
  paragraphIndex: number;
  scrollFraction: number;
  at: number;
  completedAt?: string | null;
};

export type ResolvedProgress = {
  chapterId: string;
  paragraphIndex: number;
  scrollFraction: number;
  updatedAt?: string;
  completedAt?: string | null;
  source: "server" | "local";
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
      return { chapterId: raw, paragraphIndex: 0, scrollFraction: 0, at: 0 };
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
      at: typeof parsed.at === "number" ? parsed.at : 0,
      completedAt:
        typeof parsed.completedAt === "string" || parsed.completedAt === null
          ? parsed.completedAt
          : undefined,
    };
  } catch {
    return null;
  }
}

export async function writeLocalProgress(
  bookId: string,
  progress: Omit<LocalReadingProgress, "at"> & { at?: number }
) {
  const payload: LocalReadingProgress = {
    chapterId: progress.chapterId,
    paragraphIndex: Math.max(0, Math.floor(progress.paragraphIndex)),
    scrollFraction: Math.min(1, Math.max(0, progress.scrollFraction)),
    at: progress.at ?? Date.now(),
    completedAt: progress.completedAt ?? null,
  };
  await SecureStore.setItemAsync(localProgressKey(bookId), JSON.stringify(payload));
}

/** Prefer the newer of server vs local progress. */
export function pickNewerProgress(
  server: ReadingProgress | null | undefined,
  local: LocalReadingProgress | null | undefined
): ResolvedProgress | null {
  const serverAt = server?.updated_at ? Date.parse(server.updated_at) : NaN;
  const localAt = local?.at ?? 0;
  const hasServer = Boolean(server?.chapter_id);
  const hasLocal = Boolean(local?.chapterId);

  if (hasServer && hasLocal) {
    const useLocal = Number.isFinite(serverAt) ? localAt > serverAt : localAt > 0;
    if (useLocal && local) {
      return {
        chapterId: local.chapterId,
        paragraphIndex: local.paragraphIndex,
        scrollFraction: local.scrollFraction,
        updatedAt: new Date(local.at).toISOString(),
        completedAt: local.completedAt ?? null,
        source: "local",
      };
    }
    if (server) {
      return {
        chapterId: server.chapter_id,
        paragraphIndex: server.paragraph_index,
        scrollFraction: server.scroll_fraction,
        updatedAt: server.updated_at,
        completedAt: server.completed_at ?? null,
        source: "server",
      };
    }
  }
  if (hasServer && server) {
    return {
      chapterId: server.chapter_id,
      paragraphIndex: server.paragraph_index,
      scrollFraction: server.scroll_fraction,
      updatedAt: server.updated_at,
      completedAt: server.completed_at ?? null,
      source: "server",
    };
  }
  if (hasLocal && local) {
    return {
      chapterId: local.chapterId,
      paragraphIndex: local.paragraphIndex,
      scrollFraction: local.scrollFraction,
      updatedAt: local.at ? new Date(local.at).toISOString() : undefined,
      completedAt: local.completedAt ?? null,
      source: "local",
    };
  }
  return null;
}

export function formatProgressLabel(
  chapterPosition: number,
  chapterCount: number,
  scrollFraction: number
): string {
  const chapterPct = Math.round(
    ((chapterPosition - 1 + Math.min(1, Math.max(0, scrollFraction))) /
      Math.max(1, chapterCount)) *
      100
  );
  return `Ch. ${chapterPosition} · ~${Math.min(99, Math.max(1, chapterPct))}%`;
}
