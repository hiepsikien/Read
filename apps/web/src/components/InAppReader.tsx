"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, parseContentBlocks, parseInlineMarkdown, type ReadingProgress } from "@read/api-client";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi, getStoredToken } from "@/lib/api";
import { estimateMinutes, formatPrice } from "@/lib/format";
import {
  nearestParagraphIndex,
  readLocalProgress,
  writeLocalProgress,
} from "@/lib/reading-progress";

type ChapterMeta = {
  id: string;
  position: number;
  title: string;
  word_count: number;
  locked: boolean;
};

type ReaderPayload = {
  book: { id: string; title: string; price_cents: number; publisher_name: string };
  chapter: {
    id: string;
    position: number;
    title: string;
    content: string;
    word_count: number;
  };
  chapters: ChapterMeta[];
};

const THEMES = {
  paper: {
    label: "Paper",
    bg: "#f3f7f5",
    fg: "#14221c",
    muted: "#2a3d34",
  },
  ink: {
    label: "Ink",
    bg: "#14221c",
    fg: "#e8f0ec",
    muted: "#b7c7bf",
  },
  sepia: {
    label: "Sepia",
    bg: "#efe6d6",
    fg: "#2b2118",
    muted: "#5c4d3d",
  },
} as const;

type ThemeKey = keyof typeof THEMES;

const DEFAULT_FONT_SIZE = 20;
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 28;
const PREFS_KEY = "read:reader-prefs";

function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && value in THEMES;
}

export function InAppReader({
  bookId,
  chapterId,
}: {
  bookId: string;
  chapterId: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<ReaderPayload | null>(null);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [priceCents, setPriceCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [theme, setTheme] = useState<ThemeKey>("paper");
  const [prefsRestored, setPrefsRestored] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resumeProgress, setResumeProgress] = useState<ReadingProgress | null>(null);
  const restoredKeyRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScrollRef = useRef({ fraction: 0, paragraphIndex: 0 });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setLocked(false);
      setResumeProgress(null);
      restoredKeyRef.current = null;
      try {
        const payload = await createBrowserApi().getChapter(bookId, chapterId);
        if (cancelled) return;
        setData({
          book: payload.book,
          chapter: payload.chapter,
          chapters: payload.chapters.map((chapter) => ({
            id: chapter.id,
            position: chapter.position,
            title: chapter.title,
            word_count: chapter.word_count,
            locked: Boolean(chapter.locked),
          })),
        });
        const serverProgress =
          payload.progress?.chapter_id === chapterId ? payload.progress : null;
        const local = readLocalProgress(bookId);
        const localProgress =
          local?.chapterId === chapterId
            ? {
                chapter_id: local.chapterId,
                paragraph_index: local.paragraphIndex,
                scroll_fraction: local.scrollFraction,
              }
            : null;
        setResumeProgress(serverProgress ?? localProgress);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 402) {
          const body = err.body as {
            error?: string;
            book?: { price_cents?: number };
          };
          setLocked(true);
          setPriceCents(body.book?.price_cents || 0);
          setError(body.error || "Purchase required.");
          setData(null);
          setLoading(false);
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not load chapter.");
        setData(null);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterId]);

  useEffect(() => {
    if (!data) return;
    const restoreKey = `${bookId}:${chapterId}`;
    if (restoredKeyRef.current === restoreKey) return;

    const fraction = resumeProgress?.scroll_fraction ?? 0;
    const apply = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (fraction > 0 && max > 0) {
        window.scrollTo({ top: fraction * max, behavior: "auto" });
      } else if (resumeProgress?.paragraph_index) {
        const el = document.querySelector<HTMLElement>(
          `[data-read-paragraph="${resumeProgress.paragraph_index}"]`
        );
        if (el) {
          window.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: "auto" });
        } else {
          window.scrollTo({ top: 0, behavior: "auto" });
        }
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
      restoredKeyRef.current = restoreKey;
    };

    // Wait a frame so paragraph layout is ready before restoring.
    const frame = window.requestAnimationFrame(apply);
    return () => window.cancelAnimationFrame(frame);
  }, [bookId, chapterId, data, resumeProgress]);

  useEffect(() => {
    if (!data) return;
    // Opening a chapter marks it as the resume point even before the reader scrolls.
    const paragraphIndex = resumeProgress?.paragraph_index ?? 0;
    const scrollFraction = resumeProgress?.scroll_fraction ?? 0;
    latestScrollRef.current = { fraction: scrollFraction, paragraphIndex };
    writeLocalProgress(bookId, {
      chapterId,
      paragraphIndex,
      scrollFraction,
    });
    if (getStoredToken() || user) {
      void createBrowserApi()
        .saveReadingProgress(bookId, {
          chapter_id: chapterId,
          paragraph_index: paragraphIndex,
          scroll_fraction: scrollFraction,
        })
        .catch(() => undefined);
    }
  }, [bookId, chapterId, data, resumeProgress, user]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (typeof stored.fontSize === "number") {
        setFontSize(
          Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, stored.fontSize))
        );
      }
      if (isThemeKey(stored.theme)) setTheme(stored.theme);
    } catch {
      // Corrupt or unavailable storage just means we keep the defaults.
    }
    setPrefsRestored(true);
  }, []);

  useEffect(() => {
    // Skip the first pass so defaults never overwrite what was just restored.
    if (!prefsRestored) return;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ fontSize, theme }));
  }, [fontSize, theme, prefsRestored]);

  useEffect(() => {
    function persist(fraction: number, paragraphIndex: number) {
      writeLocalProgress(bookId, {
        chapterId,
        paragraphIndex,
        scrollFraction: fraction,
      });
      if (!getStoredToken() && !user) return;
      void createBrowserApi()
        .saveReadingProgress(bookId, {
          chapter_id: chapterId,
          paragraph_index: paragraphIndex,
          scroll_fraction: fraction,
        })
        .catch(() => {
          // Progress saves are best-effort; keep reading if the network fails.
        });
    }

    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      setChromeVisible(y < 40 || y < lastY);
      lastY = y;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const fraction = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      setProgress(fraction * 100);
      const paragraphIndex = nearestParagraphIndex(y);
      latestScrollRef.current = { fraction, paragraphIndex };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        persist(fraction, paragraphIndex);
      }, 1500);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Flush the latest position when leaving the chapter.
      const latest = latestScrollRef.current;
      writeLocalProgress(bookId, {
        chapterId,
        paragraphIndex: latest.paragraphIndex,
        scrollFraction: latest.fraction,
      });
      if (getStoredToken() || user) {
        void createBrowserApi()
          .saveReadingProgress(bookId, {
            chapter_id: chapterId,
            paragraph_index: latest.paragraphIndex,
            scroll_fraction: latest.fraction,
          })
          .catch(() => undefined);
      }
    };
  }, [bookId, chapterId, user]);

  const neighbors = useMemo(() => {
    if (!data) return { prev: null as ChapterMeta | null, next: null as ChapterMeta | null };
    const index = data.chapters.findIndex((c) => c.id === data.chapter.id);
    return {
      prev: index > 0 ? data.chapters[index - 1] : null,
      next: index >= 0 && index < data.chapters.length - 1 ? data.chapters[index + 1] : null,
    };
  }, [data]);

  const palette = THEMES[theme];
  const brandTone = theme === "ink" ? "white" : "color";

  async function buy() {
    try {
      await createBrowserApi().purchaseBook(bookId);
      router.refresh();
      window.location.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      }
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center text-[var(--ink-soft)]">
        Opening chapter…
      </div>
    );
  }

  if (locked) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 text-center">
        <div className="mx-auto">
          <BrandLogo variant="mark" height={56} tone={brandTone} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-[var(--ink)]">This chapter is locked</h1>
        <p className="mt-3 text-[var(--ink-soft)]">
          Chapter 1 is free. Unlock the full book with a mock purchase to keep reading in the app.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={buy}
            className="rounded-lg bg-[var(--sage)] px-5 py-2.5 font-medium text-white"
          >
            Buy · {formatPrice(priceCents)}
          </button>
          <Link href={`/books/${bookId}`} className="rounded-lg border border-[var(--line)] px-5 py-2.5">
            Book details
          </Link>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="text-[var(--ink)]">{error || "Chapter unavailable."}</p>
        <Link href="/" className="mt-4 inline-block text-[var(--sage)] underline underline-offset-4">
          Back to library
        </Link>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{ background: palette.bg, color: palette.fg }}
    >
      <div
        className="fixed left-0 top-0 z-50 h-0.5 bg-[var(--sage)] transition-[width]"
        style={{ width: `${progress}%` }}
      />

      <header
        className={`sticky top-0 z-40 border-b transition-all duration-300 ${
          chromeVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
        style={{
          borderColor: "color-mix(in srgb, currentColor 12%, transparent)",
          background: `color-mix(in srgb, ${palette.bg} 92%, transparent)`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link href={`/books/${bookId}`} className="flex items-center" aria-label="Back to book">
            <BrandLogo variant="wordmark" height={24} tone={brandTone} />
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.max(MIN_FONT_SIZE, s - 2))}
              className="rounded-md px-2 py-1"
              style={{ background: "color-mix(in srgb, currentColor 8%, transparent)" }}
              aria-label="Decrease font size"
            >
              A−
            </button>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.min(MAX_FONT_SIZE, s + 2))}
              className="rounded-md px-2 py-1"
              style={{ background: "color-mix(in srgb, currentColor 8%, transparent)" }}
              aria-label="Increase font size"
            >
              A+
            </button>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeKey)}
              className="rounded-md border-0 px-2 py-1 text-sm"
              style={{
                background: "color-mix(in srgb, currentColor 8%, transparent)",
                color: palette.fg,
              }}
              aria-label="Reading theme"
            >
              {Object.entries(THEMES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setTocOpen(true)}
              className="rounded-md px-2 py-1 font-medium"
              style={{ background: "color-mix(in srgb, currentColor 8%, transparent)" }}
            >
              Contents
            </button>
          </div>
        </div>
      </header>

      <article className="fade-up mx-auto max-w-2xl px-4 pb-28 pt-10 sm:px-6">
        <p className="text-xs uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
          {data.book.title}
        </p>
        <h1 className="brand-mark mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
          {data.chapter.title}
        </h1>
        <p className="mt-3 text-sm" style={{ color: palette.muted }}>
          {estimateMinutes(data.chapter.word_count)} min · Chapter {data.chapter.position} of{" "}
          {data.chapters.length}
        </p>

        <div
          className="reader-serif mt-10 space-y-6 leading-[1.75]"
          style={{ fontSize: `${fontSize}px` }}
        >
          {parseContentBlocks(data.chapter.content).map((block, index) =>
            block.type === "figure" ? (
              <figure
                key={index}
                data-read-paragraph={index}
                className="-mx-4 w-[calc(100%+2rem)] sm:-mx-6 sm:w-[calc(100%+3rem)]"
              >
                <ReaderFigure src={block.src} caption={block.caption} />
                {block.caption ? (
                  <figcaption
                    className="mt-3 text-center italic"
                    style={{
                      color: palette.muted,
                      fontSize: `${Math.max(13, fontSize * 0.85)}px`,
                      lineHeight: 1.45,
                    }}
                  >
                    {block.caption}
                  </figcaption>
                ) : null}
              </figure>
            ) : (
              <p
                key={index}
                data-read-paragraph={index}
                className="whitespace-pre-wrap"
              >
                <InlineMarkdown value={block.value} />
              </p>
            )
          )}
        </div>

        <nav className="mt-14 flex items-center justify-between gap-4 border-t pt-6"
          style={{ borderColor: "color-mix(in srgb, currentColor 12%, transparent)" }}
        >
          {neighbors.prev && !neighbors.prev.locked ? (
            <Link
              href={`/read/${bookId}/${neighbors.prev.id}`}
              className="text-sm underline underline-offset-4"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {neighbors.next ? (
            neighbors.next.locked ? (
              <button type="button" onClick={buy} className="text-sm font-medium underline underline-offset-4">
                Unlock next →
              </button>
            ) : (
              <Link
                href={`/read/${bookId}/${neighbors.next.id}`}
                className="text-sm underline underline-offset-4"
              >
                Next →
              </Link>
            )
          ) : (
            <Link href={`/books/${bookId}`} className="text-sm underline underline-offset-4">
              Done
            </Link>
          )}
        </nav>
      </article>

      {tocOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close contents"
            onClick={() => setTocOpen(false)}
          />
          <div
            className="relative max-h-[80vh] w-full max-w-md overflow-auto rounded-t-2xl p-5 sm:rounded-2xl"
            style={{ background: palette.bg, color: palette.fg }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Contents</h2>
              <button type="button" onClick={() => setTocOpen(false)} className="text-sm">
                Close
              </button>
            </div>
            <ul className="space-y-1">
              {data.chapters.map((chapter) => (
                <li key={chapter.id}>
                  {chapter.locked ? (
                    <div className="rounded-lg px-3 py-2 opacity-55">
                      <p>{chapter.title}</p>
                      <p className="text-xs">Locked</p>
                    </div>
                  ) : (
                    <Link
                      href={`/read/${bookId}/${chapter.id}`}
                      onClick={() => setTocOpen(false)}
                      className="block rounded-lg px-3 py-2 transition hover:bg-black/5"
                      style={{
                        background:
                          chapter.id === data.chapter.id
                            ? "color-mix(in srgb, currentColor 8%, transparent)"
                            : undefined,
                      }}
                    >
                      {chapter.title}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function ReaderFigure({ src, caption }: { src: string; caption: string }) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const api = createBrowserApi();
    const absolute = api.mediaUrl(src);
    if (!absolute) return;

    void (async () => {
      try {
        const token = getStoredToken();
        const response = await fetch(absolute, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUri(objectUrl);
      } catch {
        // Leave empty; caption may still show.
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!uri) {
    return (
      <div
        className="flex min-h-40 items-center justify-center rounded-md"
        style={{ background: "color-mix(in srgb, currentColor 6%, transparent)" }}
        aria-label={caption || "Illustration"}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={uri}
      alt={caption || "Illustration"}
      className="max-h-[85vh] w-full rounded-md object-contain"
    />
  );
}

function InlineMarkdown({ value }: { value: string }) {
  return parseInlineMarkdown(value).map((token, index) => {
    const text = token.bold ? (
      <strong>{token.text}</strong>
    ) : token.italic ? (
      <em>{token.text}</em>
    ) : (
      token.text
    );

    return token.bold && token.italic ? (
      <strong key={`${index}-${token.text}`}>
        <em>{token.text}</em>
      </strong>
    ) : (
      <span key={`${index}-${token.text}`}>{text}</span>
    );
  });
}
