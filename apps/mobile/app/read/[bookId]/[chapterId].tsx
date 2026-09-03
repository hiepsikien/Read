import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type View as ViewType,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import {
  ApiError,
  annotateInlineTokens,
  buildReaderBlocks,
  notesFromRefBlocks,
  parseInlineMarkdown,
  uniqueNotesFromTokens,
  type ChapterListItem,
  type ReaderNote,
  type ReaderRenderRole,
  type ReadingProgress,
  type RefBlock,
} from "@read/api-client";
import { AuthenticatedImage } from "../../../components/AuthenticatedImage";
import { BrandLogo } from "../../../components/BrandLogo";
import { ExplainSheet } from "../../../components/ExplainSheet";
import { FinishedBookOverlay } from "../../../components/FinishedBookOverlay";
import { ReaderPagesView } from "../../../components/ReaderPagesView";
import { getApiBaseUrl } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import {
  FONT_SIZE_STEP,
  useReaderPreferences,
} from "../../../lib/reader-preferences";
import {
  pickNewerProgress,
  readLocalProgress,
  writeLocalProgress,
} from "../../../lib/reading-progress";
import {
  clearNarrationContinue,
  isNarrationAutoPlayPending,
  isNarrationContinueActive,
  requestNarrationContinue,
  type ChapterTransition,
} from "../../../lib/narration-continue";
import { useIosNarration } from "../../../lib/use-ios-narration";
import { VoicePickerModal } from "../../../lib/voice-picker";
import {
  colors,
  estimateMinutes,
  formatPrice,
  readerThemes,
} from "../../../lib/theme";

type ReaderPayload = {
  book: { id: string; title: string; price_cents: number; publisher_name: string; language?: string | null };
  chapter: {
    id: string;
    position: number;
    title: string;
    content: string;
    word_count: number;
    blocks?: RefBlock[] | null;
    hub_chapter_id?: string | null;
  };
  chapters: ChapterListItem[];
  notes?: ReaderNote[];
};

const TOC_ROW_HEIGHT = 56;
const EMPTY_NOTES: ReaderNote[] = [];

function renderInlineTitle(value: string, weight?: "600" | "700") {
  return parseInlineMarkdown(value).map((token, index) => (
    <Text
      key={`${index}-${token.text}`}
      style={[
        weight ? { fontWeight: weight } : null,
        token.bold && styles.inlineBold,
        token.italic && styles.inlineItalic,
      ]}
    >
      {token.text}
    </Text>
  ));
}

export default function ReaderScreen() {
  const { bookId, chapterId } = useLocalSearchParams<{ bookId: string; chapterId: string }>();
  const router = useRouter();
  const { user, api } = useAuth();
  const insets = useSafeAreaInsets();
  const [pageBox, setPageBox] = useState({ width: 0, height: 0 });

  const [data, setData] = useState<ReaderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [priceCents, setPriceCents] = useState(0);
  const [error, setError] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainMode, setExplainMode] = useState<"ask" | "result">("ask");
  const [explainParagraph, setExplainParagraph] = useState<number | null>(null);
  const [explainEntryId, setExplainEntryId] = useState<string | null>(null);
  const [pressedParagraph, setPressedParagraph] = useState<number | null>(null);
  const { fontSize, theme, readingMode, changeFontSize, cycleTheme, cycleReadingMode } =
    useReaderPreferences();

  const toggleReadingMode = useCallback(() => {
    const { paragraphIndex, scrollFraction } = latestProgressRef.current;
    setModeAnchorParagraph(paragraphIndex);
    if (chapterId) {
      const snapshot: ReadingProgress = {
        chapter_id: chapterId,
        paragraph_index: paragraphIndex,
        scroll_fraction: scrollFraction,
      };
      resumeProgressRef.current = snapshot;
      setResumeProgress(snapshot);
    }
    restoredKeyRef.current = null;
    cycleReadingMode();
  }, [chapterId, cycleReadingMode]);

  const scrollRef = useRef<ScrollView>(null);
  const tocListRef = useRef<FlatList<ChapterListItem>>(null);
  const contentRef = useRef<ViewType>(null);
  const paragraphRefs = useRef<Array<ViewType | null>>([]);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  // Follow the spoken paragraph until the reader manually scrolls away.
  const followNarrationRef = useRef(true);
  const restoredKeyRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestProgressRef = useRef({ paragraphIndex: 0, scrollFraction: 0 });
  const edgeTapGuardRef = useRef<{ consume: () => void } | null>(null);
  const resumeProgressRef = useRef<ReadingProgress | null>(null);
  const [resumeProgress, setResumeProgress] = useState<ReadingProgress | null>(null);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [modeAnchorParagraph, setModeAnchorParagraph] = useState(0);
  const [chapterToast, setChapterToast] = useState<ChapterTransition | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const speechStopRef = useRef<() => Promise<void>>(async () => undefined);

  const persistProgress = useCallback(
    async (paragraphIndex: number, scrollFraction: number) => {
      if (!bookId || !chapterId) return;
      latestProgressRef.current = { paragraphIndex, scrollFraction };
      try {
        await writeLocalProgress(bookId, {
          chapterId,
          paragraphIndex,
          scrollFraction,
        });
      } catch {
        // Local write should not crash the reader (esp. while backgrounded).
      }
      if (!user) return;
      try {
        await api.saveReadingProgress(bookId, {
          chapter_id: chapterId,
          paragraph_index: paragraphIndex,
          scroll_fraction: scrollFraction,
        });
      } catch {
        // Best-effort sync; local mirror already updated.
      }
    },
    [api, bookId, chapterId, user]
  );

  const load = useCallback(async () => {
    if (!bookId || !chapterId) return;
    // Keep prior chapter on screen during auto-advance so the handoff is not a blank spinner.
    const softContinue = isNarrationContinueActive();
    if (!softContinue) setLoading(true);
    setError("");
    setLocked(false);
    setResumeProgress(null);
    resumeProgressRef.current = null;
    restoredKeyRef.current = null;
    const forceStart = softContinue;
    try {
      const payload = await api.getChapter(bookId, chapterId);
      setData(payload);
      const server =
        payload.progress?.chapter_id === chapterId ? payload.progress : null;
      const local = await readLocalProgress(bookId);
      const picked =
        forceStart
          ? null
          : local?.chapterId === chapterId
            ? pickNewerProgress(server, local)
            : server
              ? {
                  chapterId: server.chapter_id,
                  paragraphIndex: server.paragraph_index,
                  scrollFraction: server.scroll_fraction,
                  updatedAt: server.updated_at,
                  completedAt: server.completed_at,
                  source: "server" as const,
                }
              : null;
      const resolved = picked
        ? {
            chapter_id: picked.chapterId,
            paragraph_index: picked.paragraphIndex,
            scroll_fraction: picked.scrollFraction,
            updated_at: picked.updatedAt,
            completed_at: picked.completedAt,
          }
        : forceStart
          ? {
              chapter_id: chapterId,
              paragraph_index: 0,
              scroll_fraction: 0,
              updated_at: new Date().toISOString(),
              completed_at: null,
            }
          : null;
      setResumeProgress(resolved);
      resumeProgressRef.current = resolved;
      const paragraphIndex = resolved?.paragraph_index ?? 0;
      const scrollFraction = resolved?.scroll_fraction ?? 0;
      latestProgressRef.current = { paragraphIndex, scrollFraction };
      setModeAnchorParagraph(paragraphIndex);
      await writeLocalProgress(bookId, {
        chapterId,
        paragraphIndex,
        scrollFraction,
        completedAt: resolved?.completed_at ?? null,
      });
      if (user) {
        void api
          .saveReadingProgress(bookId, {
            chapter_id: chapterId,
            paragraph_index: paragraphIndex,
            scroll_fraction: scrollFraction,
          })
          .catch(() => undefined);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        const body = err.body as { book?: { price_cents?: number } };
        setLocked(true);
        setPriceCents(body.book?.price_cents ?? 0);
        setData(null);
        clearNarrationContinue();
      } else {
        setError(err instanceof ApiError ? err.message : "Could not load chapter.");
        clearNarrationContinue();
      }
    } finally {
      setLoading(false);
    }
  }, [api, bookId, chapterId, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        const latest = latestProgressRef.current;
        void persistProgress(latest.paragraphIndex, latest.scrollFraction);
      };
    }, [load, persistProgress])
  );

  async function buy() {
    if (!user) {
      router.push("/login");
      return;
    }
    try {
      await api.purchaseBook(bookId!);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push("/login");
    }
  }

  const markFinished = useCallback(async () => {
    if (!bookId || !chapterId) return;
    const latest = latestProgressRef.current;
    await writeLocalProgress(bookId, {
      chapterId,
      paragraphIndex: latest.paragraphIndex,
      scrollFraction: 1,
      completedAt: new Date().toISOString(),
    });
    if (user) {
      try {
        await api.saveReadingProgress(bookId, {
          chapter_id: chapterId,
          paragraph_index: latest.paragraphIndex,
          scroll_fraction: 1,
          completed: true,
        });
      } catch {
        // Local completed flag still set.
      }
    }
    setFinishedOpen(true);
  }, [api, bookId, chapterId, user]);

  const readAgain = useCallback(async () => {
    if (!bookId || !data?.chapters[0]) return;
    const first = data.chapters[0];
    await writeLocalProgress(bookId, {
      chapterId: first.id,
      paragraphIndex: 0,
      scrollFraction: 0,
      completedAt: null,
    });
    if (user) {
      try {
        await api.saveReadingProgress(bookId, {
          chapter_id: first.id,
          paragraph_index: 0,
          scroll_fraction: 0,
          completed: false,
        });
      } catch {
        // Ignore; local cleared.
      }
    }
    setFinishedOpen(false);
    router.replace(`/read/${bookId}/${first.id}`);
  }, [api, bookId, data?.chapters, router, user]);

  const neighbors = useMemo(() => {
    if (!data) return { prev: null as ChapterListItem | null, next: null as ChapterListItem | null };
    const index = data.chapters.findIndex((c) => c.id === data.chapter.id);
    return {
      prev: index > 0 ? data.chapters[index - 1] : null,
      next: index >= 0 && index < data.chapters.length - 1 ? data.chapters[index + 1] : null,
    };
  }, [data]);
  const neighborsRef = useRef(neighbors);
  neighborsRef.current = neighbors;

  // Native text renders every newline as a hard break, so collapse the soft
  // line wrapping that survives inside a paragraph. Figures stay as markdown
  // blocks so speech can read captions and progress indexes stay stable.
  const paragraphs = useMemo(
    () =>
      (data?.chapter.content ?? "")
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
        .filter(Boolean),
    [data?.chapter.content]
  );
  const notes = useMemo(
    () => notesFromRefBlocks(data?.chapter.blocks, data?.notes ?? EMPTY_NOTES),
    [data?.chapter.blocks, data?.notes]
  );
  const blocks = useMemo(
    () =>
      buildReaderBlocks(data?.chapter.content ?? "", {
        refBlocks: data?.chapter.blocks,
        notes,
        chapterTitle: data?.chapter.title,
      }),
    [data?.chapter.blocks, data?.chapter.content, data?.chapter.title, notes]
  );
  const blockTokens = useMemo(
    () => blocks.map((block) => (block.kind === "prose" ? block.tokens : null)),
    [blocks]
  );
  const explainParagraphNotes = useMemo(() => {
    if (explainParagraph == null) return [];
    return uniqueNotesFromTokens(blockTokens[explainParagraph] ?? [], notes);
  }, [blockTokens, explainParagraph, notes]);

  const handleChapterComplete = useCallback(() => {
    if (!bookId) return;
    const next = neighborsRef.current.next;
    if (next && !next.locked) {
      requestNarrationContinue({
        position: next.position,
        title: next.title,
      });
      setChapterToast({
        position: next.position,
        title: next.title,
      });
      toastOpacity.setValue(0);
      contentOpacity.setValue(0.25);
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(toastOpacity, {
            toValue: 1,
            duration: 320,
            useNativeDriver: true,
          }),
          Animated.delay(1600),
          Animated.timing(toastOpacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      ]).start(({ finished }) => {
        if (finished) setChapterToast(null);
      });
      void persistProgress(
        Math.max(0, paragraphs.length - 1),
        1
      );
      router.replace(`/read/${bookId}/${next.id}`);
      return;
    }
    if (next?.locked) {
      clearNarrationContinue();
      router.replace(`/read/${bookId}/${next.id}`);
      return;
    }
    clearNarrationContinue();
    void markFinished();
  }, [
    bookId,
    contentOpacity,
    markFinished,
    paragraphs.length,
    persistProgress,
    router,
    toastOpacity,
  ]);

  // Public cover endpoint — lock-screen artwork loads without Bearer.
  const artworkUrl = useMemo(
    () => (bookId ? `${getApiBaseUrl()}/api/books/${bookId}/cover` : null),
    [bookId]
  );

  const speech = useIosNarration({
    api,
    bookId,
    chapterId,
    paragraphs,
    bookTitle: data?.book.title,
    chapterTitle: data?.chapter.title,
    artworkUrl,
    artistName: data?.book.publisher_name,
    onChapterComplete: handleChapterComplete,
  });
  speechStopRef.current = speech.stop;

  // The book screen is already one level down in the stack, so popping avoids
  // pushing a second copy of it that would need two back presses to clear.
  const leaveReader = useCallback(() => {
    clearNarrationContinue();
    void speech.stop();
    if (router.canGoBack()) router.back();
    else router.replace(`/books/${bookId}`);
  }, [router, bookId, speech.stop]);

  useEffect(() => {
    followNarrationRef.current = true;
    paragraphRefs.current = [];
  }, [bookId, chapterId]);

  const scrollSpokenParagraphIntoView = useCallback((index: number) => {
    const paragraph = paragraphRefs.current[index];
    const content = contentRef.current;
    if (!paragraph || !content || !followNarrationRef.current) return;

    paragraph.measureLayout(
      content,
      (_x, y, _width, height) => {
        if (!followNarrationRef.current) return;
        const topPad = 24;
        const bottomPad = 72;
        const viewTop = scrollYRef.current + topPad;
        const viewBottom = scrollYRef.current + viewportHeightRef.current - bottomPad;
        const paraTop = y;
        const paraBottom = y + height;

        // Already comfortably visible — don't jostle the page.
        if (paraTop >= viewTop && paraBottom <= viewBottom) return;

        scrollRef.current?.scrollTo({
          y: Math.max(0, paraTop - topPad),
          animated: true,
        });
      },
      () => {
        // measureLayout can fail mid-unmount; ignore.
      }
    );
  }, []);

  const restoreReadingPosition = useCallback(() => {
    if (!bookId || !chapterId || !data) return;
    const restoreKey = `${bookId}:${chapterId}`;
    if (restoredKeyRef.current === restoreKey) return;
    const resume = resumeProgressRef.current;
    const paragraphIndex = resume?.paragraph_index ?? 0;
    const scrollFraction = resume?.scroll_fraction ?? 0;

    const finish = () => {
      restoredKeyRef.current = restoreKey;
    };

    if (paragraphIndex > 0) {
      const paragraph = paragraphRefs.current[paragraphIndex];
      const content = contentRef.current;
      if (paragraph && content) {
        paragraph.measureLayout(
          content,
          (_x, y) => {
            scrollRef.current?.scrollTo({
              y: Math.max(0, y - 24),
              animated: false,
            });
            finish();
          },
          () => {
            if (scrollFraction > 0 && contentHeightRef.current > viewportHeightRef.current) {
              const max = contentHeightRef.current - viewportHeightRef.current;
              scrollRef.current?.scrollTo({
                y: Math.max(0, scrollFraction * max),
                animated: false,
              });
            }
            finish();
          }
        );
        return;
      }
    }

    if (scrollFraction > 0 && contentHeightRef.current > viewportHeightRef.current) {
      const max = contentHeightRef.current - viewportHeightRef.current;
      scrollRef.current?.scrollTo({
        y: Math.max(0, scrollFraction * max),
        animated: false,
      });
    }
    finish();
  }, [bookId, chapterId, data]);

  useEffect(() => {
    if (readingMode === "pages") return;
    if (speech.playbackState !== "speaking") return;
    if (speech.currentParagraph === null) return;
    scrollSpokenParagraphIntoView(speech.currentParagraph);
  }, [
    readingMode,
    speech.currentParagraph,
    speech.playbackState,
    scrollSpokenParagraphIntoView,
  ]);

  const onReaderScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      scrollYRef.current = contentOffset.y;
      viewportHeightRef.current = layoutMeasurement.height;
      contentHeightRef.current = contentSize.height;
      const max = Math.max(0, contentSize.height - layoutMeasurement.height);
      const scrollFraction = max > 0 ? Math.min(1, Math.max(0, contentOffset.y / max)) : 0;
      // Approximate the top-most visible paragraph from scroll fraction.
      const paragraphCount = Math.max(1, paragraphRefs.current.length);
      const paragraphIndex = Math.min(
        paragraphCount - 1,
        Math.max(0, Math.floor(scrollFraction * paragraphCount))
      );
      latestProgressRef.current = { paragraphIndex, scrollFraction };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistProgress(paragraphIndex, scrollFraction);
      }, 1500);
    },
    [persistProgress]
  );

  // Stable deps: only stop on true blur/unmount. Dependency changes to
  // speech.stop previously re-ran cleanup and killed autoplay mid-continue.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (isNarrationContinueActive()) return;
        void speechStopRef.current();
      };
    }, [])
  );

  // Drop the continue latch only after audio is audibly going, so a late focus
  // cleanup cannot race-stop prepare/play on the next chapter.
  useEffect(() => {
    if (!isNarrationContinueActive()) return;
    if (speech.playbackState === "speaking") {
      clearNarrationContinue();
    }
  }, [speech.playbackState]);

  // Retry-friendly autoplay: keep pending until speaking. Avoid depending on
  // speech.startPlayback identity (churn would re-enter and fight prepare).
  const startPlaybackRef = useRef(speech.startPlayback);
  startPlaybackRef.current = speech.startPlayback;

  useEffect(() => {
    if (!isNarrationAutoPlayPending()) return;
    if (loading || locked || !data || paragraphs.length === 0) return;
    if (data.chapter.id !== chapterId) return;
    if (speech.playbackState === "preparing" || speech.playbackState === "speaking") {
      return;
    }

    followNarrationRef.current = true;
    // Let the chapter banner breathe before audio starts.
    let cancelled = false;
    const startTimer = setTimeout(() => {
      if (cancelled || !isNarrationAutoPlayPending()) return;
      void startPlaybackRef.current(0);
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
    };
  }, [
    loading,
    locked,
    data,
    paragraphs.length,
    chapterId,
    speech.playbackState,
  ]);

  useEffect(() => {
    if (!isNarrationContinueActive()) return;
    const failSafe = setTimeout(() => {
      if (isNarrationContinueActive()) clearNarrationContinue();
    }, 25000);
    return () => clearTimeout(failSafe);
  }, [chapterId, speech.playbackState]);

  useEffect(() => {
    if (!data || loading || readingMode !== "scroll") return;
    // Give paragraph refs a tick to attach before measuring.
    const timer = setTimeout(() => restoreReadingPosition(), 50);
    return () => clearTimeout(timer);
  }, [data, loading, resumeProgress, readingMode, restoreReadingPosition]);

  const palette = readerThemes[theme];
  const activeChapterIndex = data
    ? Math.max(0, data.chapters.findIndex((chapter) => chapter.id === data.chapter.id))
    : 0;
  const brandTone = theme === "ink" ? "white" : "color";
  // Soft auto-advance keeps prior chapter painted; only block on cold loads.
  const blockingLoad = loading && !data;

  if (blockingLoad) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.bg }]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  if (locked) {
    return (
      <SafeAreaView style={[styles.lockedWrap, { backgroundColor: palette.bg }]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <BrandLogo variant="mark" height={52} tone={brandTone} style={{ marginBottom: 8 }} />
        <Text style={[styles.lockedTitle, { color: palette.fg }]}>This chapter is locked</Text>
        <Text style={[styles.lockedBody, { color: palette.muted }]}>
          Chapter 1 is free. Unlock the full book with a mock purchase to keep reading.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={buy}>
          <Text style={styles.primaryBtnText}>Buy · {formatPrice(priceCents)}</Text>
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={leaveReader}>
          <Text style={[styles.linkText, { color: palette.fg }]}>Book details</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: palette.bg }]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <Text style={{ color: palette.fg }}>{error || "Chapter unavailable."}</Text>
        <Pressable style={styles.linkBtn} onPress={() => router.replace("/")}>
          <Text style={[styles.linkText, { color: colors.sage }]}>Back to library</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.reader, { backgroundColor: palette.bg }]} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={[styles.bar, { borderBottomColor: withAlpha(palette.fg, 0.12) }]}>
        <Pressable onPress={leaveReader} accessibilityLabel="Back to book" style={{ flexShrink: 0 }}>
          <BrandLogo variant="mark" height={26} tone={brandTone} />
        </Pressable>
        <View style={styles.barControls}>
          <Pressable style={chip(palette.fg)} onPress={() => changeFontSize(-FONT_SIZE_STEP)}>
            <Text style={[styles.chipText, { color: palette.fg }]}>A−</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={() => changeFontSize(FONT_SIZE_STEP)}>
            <Text style={[styles.chipText, { color: palette.fg }]}>A+</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={cycleTheme}>
            <Text style={[styles.chipText, { color: palette.fg }]}>{palette.label}</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={toggleReadingMode}>
            <Text style={[styles.chipText, styles.chipTextStrong, { color: palette.fg }]}>
              {readingMode === "pages" ? "Pages" : "Scroll"}
            </Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={() => setTocOpen(true)}>
            <Text style={[styles.chipText, styles.chipTextStrong, { color: palette.fg }]}>
              Contents
            </Text>
          </Pressable>
        </View>
      </View>

      {speech.supported ? (
        <View
          style={[
            styles.speechBar,
            {
              backgroundColor: withAlpha(palette.fg, 0.04),
              borderBottomColor: withAlpha(palette.fg, 0.12),
            },
          ]}
        >
          <Text style={[styles.speechLabel, { color: palette.muted }]}>
            {speech.provider === "cloud"
              ? `${speech.manifest?.engine ?? "Cloud"}${
                  speech.manifest?.gender ? ` · ${speech.manifest.gender}` : ""
                }`
              : "Offline voice"}
          </Text>
          <View style={styles.speechControls}>
            <Pressable
              disabled={speech.playbackState === "preparing"}
              accessibilityRole="button"
              accessibilityLabel={
                speech.playbackState === "speaking"
                  ? "Pause reading"
                  : speech.playbackState === "paused"
                    ? "Resume reading"
                    : "Read chapter aloud"
              }
              style={chip(palette.fg)}
              onPress={() => {
                followNarrationRef.current = true;
                void speech.togglePlayback({
                  fromParagraphIndex: latestProgressRef.current.paragraphIndex,
                });
              }}
            >
              <Text style={{ color: palette.fg, fontWeight: "600" }}>
                {speech.playbackState === "preparing"
                  ? "Preparing…"
                  : speech.playbackState === "speaking"
                  ? "Pause"
                  : speech.playbackState === "paused"
                    ? "Resume"
                    : "Play"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Reading speed ${speech.rate} times`}
              style={chip(palette.fg)}
              onPress={() => void speech.cycleRate()}
            >
              <Text style={{ color: palette.fg }}>{speech.rate}×</Text>
            </Pressable>
            {speech.playbackState !== "idle" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop reading"
                style={chip(palette.fg)}
                onPress={() => {
                  clearNarrationContinue();
                  void speech.stop();
                }}
              >
                <Text style={{ color: palette.fg }}>Stop</Text>
              </Pressable>
            ) : null}
            {user?.role === "admin" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change narration voice"
                style={chip(palette.fg)}
                onPress={() => {
                  void speech.pause();
                  setVoiceOpen(true);
                }}
              >
                <Text style={{ color: palette.fg }}>Voice</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {chapterToast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.chapterToast,
            {
              opacity: toastOpacity,
              backgroundColor: palette.bg,
              borderColor: withAlpha(palette.fg, 0.14),
            },
          ]}
        >
          <Text style={[styles.chapterToastEyebrow, { color: palette.muted }]}>
            Chapter {chapterToast.position}
          </Text>
          <Text style={[styles.chapterToastTitle, { color: palette.fg }]} numberOfLines={2}>
            {chapterToast.title}
          </Text>
        </Animated.View>
      ) : null}

      <Animated.View style={{ flex: 1, opacity: contentOpacity }}>
      {readingMode === "pages" ? (
        <View
          style={{ flex: 1 }}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setPageBox((prev) =>
              prev.width === width && prev.height === height ? prev : { width, height }
            );
          }}
        >
          {pageBox.height > 0 ? (
          <ReaderPagesView
            key={`pages-${chapterId}-${modeAnchorParagraph}-${fontSize}-${theme}`}
            blockCount={blocks.length}
            pageWidth={pageBox.width}
            pageHeight={pageBox.height}
            bottomReserve={36 + Math.max(insets.bottom, 8)}
            renderFooter={(pageIndex, pageCount, isLast) => (
              <View style={styles.pagesFooter}>
                <View style={styles.pagesFooterSide}>
                  {isLast && neighbors.prev && !neighbors.prev.locked ? (
                    <Pressable
                      hitSlop={NAV_HIT_SLOP}
                      onPress={() => router.replace(`/read/${bookId}/${neighbors.prev!.id}`)}
                    >
                      <Text style={[styles.navText, { color: palette.fg }]}>← Previous</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text
                  pointerEvents="none"
                  style={[styles.pagesPageLabel, { color: palette.muted }]}
                >
                  {pageIndex + 1} / {pageCount}
                </Text>
                <View style={[styles.pagesFooterSide, styles.pagesFooterSideRight]}>
                  {isLast ? (
                    neighbors.next ? (
                      neighbors.next.locked ? (
                        <Pressable hitSlop={NAV_HIT_SLOP} onPress={buy}>
                          <Text style={[styles.navText, { color: palette.fg, fontWeight: "600" }]}>
                            Unlock next →
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          hitSlop={NAV_HIT_SLOP}
                          onPress={() => router.replace(`/read/${bookId}/${neighbors.next!.id}`)}
                        >
                          <Text style={[styles.navText, { color: palette.fg }]}>Next →</Text>
                        </Pressable>
                      )
                    ) : (
                      <Pressable hitSlop={NAV_HIT_SLOP} onPress={() => void markFinished()}>
                        <Text style={[styles.navText, { color: palette.fg }]}>Done</Text>
                      </Pressable>
                    )
                  ) : null}
                </View>
              </View>
            )}
            mutedColor={palette.muted}
            firstPageHeader={
              <View style={{ gap: 6, marginBottom: 8 }}>
                <Text style={[styles.readerEyebrow, { color: palette.muted }]}>
                  {data.book.title}
                </Text>
                <Text style={[styles.readerTitle, { color: palette.fg }]}>
                  {renderInlineTitle(data.chapter.title, "700")}
                </Text>
                <Text style={[styles.readerMeta, { color: palette.muted }]}>
                  {estimateMinutes(data.chapter.word_count)} min · Chapter{" "}
                  {data.chapter.position} of {data.chapters.length}
                </Text>
              </View>
            }
            followParagraphIndex={
              speech.playbackState === "speaking" || speech.playbackState === "paused"
                ? speech.currentParagraph
                : null
            }
            followEnabled={
              speech.playbackState === "speaking" || speech.playbackState === "paused"
            }
            initialParagraphIndex={modeAnchorParagraph}
            edgeTapGuardRef={edgeTapGuardRef}
            onPageChange={(pageIndex, page, pageCount) => {
              const paragraphIndex = page.startIndex;
              const scrollFraction =
                pageCount > 1 ? pageIndex / (pageCount - 1) : pageCount === 1 ? 1 : 0;
              latestProgressRef.current = { paragraphIndex, scrollFraction };
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              saveTimerRef.current = setTimeout(() => {
                void persistProgress(paragraphIndex, scrollFraction);
              }, 1500);
            }}
            renderBlock={(index) => {
              const block = blocks[index];
              if (!block) return null;
              const selected =
                explainOpen && explainEntryId == null && explainParagraph === index;
              return (
                <View
                  key={index}
                  ref={(node) => {
                    paragraphRefs.current[index] = node;
                  }}
                  collapsable={false}
                  style={[
                    styles.paragraph,
                    (speech.currentParagraph === index ||
                      selected ||
                      pressedParagraph === index) && {
                      backgroundColor: withAlpha(palette.fg, 0.1),
                    },
                  ]}
                >
                  {block.kind === "figure" ? (
                    <View style={styles.figure}>
                      {api.mediaUrl(block.src) ? (
                        <AuthenticatedImage
                          url={api.mediaUrl(block.src)!}
                          style={styles.figureImage}
                          fillWidth
                          accessibilityLabel={block.caption || "Illustration"}
                        />
                      ) : null}
                      {block.caption ? (
                        <Text
                          style={[
                            styles.figureCaption,
                            { color: palette.muted, fontSize: Math.max(13, fontSize * 0.85) },
                          ]}
                        >
                          {block.caption}
                        </Text>
                      ) : null}
                    </View>
                  ) : block.kind === "hr" ? (
                    <View
                      style={{
                        height: 1,
                        marginVertical: 12,
                        backgroundColor: withAlpha(palette.fg, 0.18),
                      }}
                    />
                  ) : (
                    <AnnotatedParagraph
                      value={block.value}
                      tokens={blockTokens[index] ?? []}
                      notes={notes}
                      palette={palette}
                      fontSize={fontSize}
                      role={block.role}
                      level={block.level}
                      onPressNote={(noteId) => {
                        edgeTapGuardRef.current?.consume();
                        setPressedParagraph(null);
                        setExplainMode("result");
                        setExplainEntryId(noteId);
                        setExplainParagraph(index);
                        setExplainOpen(true);
                      }}
                      onPressParagraph={() => {
                        edgeTapGuardRef.current?.consume();
                        setExplainMode("result");
                        setExplainEntryId(null);
                        setExplainParagraph(index);
                        setExplainOpen(true);
                      }}
                      onPressParagraphIn={() => setPressedParagraph(index)}
                      onPressParagraphOut={() => setPressedParagraph(null)}
                    />
                  )}
                </View>
              );
            }}
          />
          ) : null}
        </View>
      ) : (
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.readerBody}
        onScroll={onReaderScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => {
          contentHeightRef.current = height;
          restoreReadingPosition();
        }}
        onLayout={(event) => {
          viewportHeightRef.current = event.nativeEvent.layout.height;
        }}
        onScrollBeginDrag={() => {
          followNarrationRef.current = false;
        }}
      >
        <View ref={contentRef} collapsable={false}>
          <Text style={[styles.readerEyebrow, { color: palette.muted }]}>{data.book.title}</Text>
          <Text style={[styles.readerTitle, { color: palette.fg }]}>
            {renderInlineTitle(data.chapter.title, "700")}
          </Text>
          <Text style={[styles.readerMeta, { color: palette.muted }]}>
            {estimateMinutes(data.chapter.word_count)} min · Chapter {data.chapter.position} of{" "}
            {data.chapters.length}
          </Text>

          <View style={styles.paragraphs}>
            {blocks.map((block, index) => {
              const selected =
                explainOpen && explainEntryId == null && explainParagraph === index;
              return (
                <View
                  key={index}
                  ref={(node) => {
                    paragraphRefs.current[index] = node;
                  }}
                  collapsable={false}
                  style={[
                    styles.paragraph,
                    (speech.currentParagraph === index ||
                      selected ||
                      pressedParagraph === index) && {
                      backgroundColor: withAlpha(palette.fg, 0.1),
                    },
                  ]}
                >
                {block.kind === "figure" ? (
                  <View style={styles.figure}>
                    {api.mediaUrl(block.src) ? (
                      <AuthenticatedImage
                        url={api.mediaUrl(block.src)!}
                        style={styles.figureImage}
                        fillWidth
                        accessibilityLabel={block.caption || "Illustration"}
                      />
                    ) : null}
                    {block.caption ? (
                      <Text
                        style={[
                          styles.figureCaption,
                          { color: palette.muted, fontSize: Math.max(13, fontSize * 0.85) },
                        ]}
                      >
                        {block.caption}
                      </Text>
                    ) : null}
                  </View>
                ) : block.kind === "hr" ? (
                  <View
                    style={{
                      height: 1,
                      marginVertical: 12,
                      backgroundColor: withAlpha(palette.fg, 0.18),
                    }}
                  />
                ) : (
                  <AnnotatedParagraph
                    value={block.value}
                    tokens={blockTokens[index] ?? []}
                    notes={notes}
                    palette={palette}
                    fontSize={fontSize}
                    role={block.role}
                    level={block.level}
                    onPressNote={(noteId) => {
                      edgeTapGuardRef.current?.consume();
                      setPressedParagraph(null);
                      setExplainMode("result");
                      setExplainEntryId(noteId);
                      setExplainParagraph(index);
                      setExplainOpen(true);
                    }}
                    onPressParagraph={() => {
                      edgeTapGuardRef.current?.consume();
                      setExplainMode("result");
                      setExplainEntryId(null);
                      setExplainParagraph(index);
                      setExplainOpen(true);
                    }}
                    onPressParagraphIn={() => setPressedParagraph(index)}
                    onPressParagraphOut={() => setPressedParagraph(null)}
                  />
                )}
              </View>
            );
            })}
          </View>
          {speech.error ? (
            <Text accessibilityRole="alert" style={[styles.speechError, { color: palette.muted }]}>
              {speech.error}
            </Text>
          ) : null}

          <View style={[styles.nav, { borderTopColor: withAlpha(palette.fg, 0.12) }]}>
            {neighbors.prev && !neighbors.prev.locked ? (
              <Pressable onPress={() => router.replace(`/read/${bookId}/${neighbors.prev!.id}`)}>
                <Text style={[styles.navText, { color: palette.fg }]}>← Previous</Text>
              </Pressable>
            ) : (
              <View />
            )}
            {neighbors.next ? (
              neighbors.next.locked ? (
                <Pressable onPress={buy}>
                  <Text style={[styles.navText, { color: palette.fg, fontWeight: "600" }]}>
                    Unlock next →
                  </Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => router.replace(`/read/${bookId}/${neighbors.next!.id}`)}>
                  <Text style={[styles.navText, { color: palette.fg }]}>Next →</Text>
                </Pressable>
              )
            ) : (
              <Pressable onPress={() => void markFinished()}>
                <Text style={[styles.navText, { color: palette.fg }]}>Done</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
      )}
      </Animated.View>

      <FinishedBookOverlay
        visible={finishedOpen}
        bookId={bookId!}
        bookTitle={data.book.title}
        firstChapterId={data.chapters[0]?.id ?? null}
        onClose={() => {
          setFinishedOpen(false);
          leaveReader();
        }}
        onReadAgain={() => void readAgain()}
        onOpenBook={(id) => {
          setFinishedOpen(false);
          router.replace(`/books/${id}`);
        }}
      />

      <ExplainSheet
        visible={explainOpen}
        mode={explainMode}
        api={api}
        bookId={bookId!}
        chapterId={chapterId!}
        bookLanguage={data?.book.language || "en"}
        palette={palette}
        bookLanguage={data.book.language}
        paragraphIndex={explainParagraph}
        paragraphNotes={explainParagraphNotes}
        entryId={explainEntryId}
        onClose={() => {
          setExplainOpen(false);
          setExplainEntryId(null);
          setPressedParagraph(null);
        }}
      />

      <VoicePickerModal
        visible={voiceOpen}
        api={api}
        palette={palette}
        onClose={() => setVoiceOpen(false)}
        onSaved={() => void speech.reloadVoice()}
      />

      <Modal visible={tocOpen} animationType="slide" transparent onRequestClose={() => setTocOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTocOpen(false)} />
        <View style={[styles.modalSheet, { backgroundColor: palette.bg }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: palette.fg }]}>Contents</Text>
            <Pressable onPress={() => setTocOpen(false)}>
              <Text style={{ color: palette.fg }}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            ref={tocListRef}
            data={data.chapters}
            keyExtractor={(chapter) => chapter.id}
            initialNumToRender={Math.max(12, activeChapterIndex + 4)}
            getItemLayout={(_, index) => ({
              length: TOC_ROW_HEIGHT,
              offset: TOC_ROW_HEIGHT * index,
              index,
            })}
            onLayout={() => {
              if (activeChapterIndex <= 0) return;
              requestAnimationFrame(() => {
                tocListRef.current?.scrollToIndex({
                  index: activeChapterIndex,
                  viewPosition: 0.25,
                  animated: false,
                });
              });
            }}
            onScrollToIndexFailed={({ index }) => {
              tocListRef.current?.scrollToOffset({
                offset: Math.max(0, index * TOC_ROW_HEIGHT - 40),
                animated: false,
              });
            }}
            renderItem={({ item: chapter }) => {
              const active = chapter.id === data.chapter.id;
              return (
                <Pressable
                  disabled={chapter.locked}
                  style={[
                    styles.tocRow,
                    { minHeight: TOC_ROW_HEIGHT },
                    active && { backgroundColor: withAlpha(palette.fg, 0.08) },
                  ]}
                  onPress={() => {
                    setTocOpen(false);
                    router.replace(`/read/${bookId}/${chapter.id}`);
                  }}
                >
                  <Text style={[{ color: palette.fg }, chapter.locked && styles.tocLocked]}>
                    {renderInlineTitle(chapter.title)}
                  </Text>
                  {active ? (
                    <Text style={[styles.tocLockedLabel, { color: palette.muted }]}>Now reading</Text>
                  ) : null}
                  {chapter.locked ? (
                    <Text style={[styles.tocLockedLabel, { color: palette.muted }]}>Locked</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function noteStyle(groupLabel: string, palette: { fg: string }) {
  const kind = groupLabel.trim().toLowerCase();
  if (kind === "thuật ngữ") {
    return {
      textDecorationLine: "underline" as const,
      textDecorationColor: withAlpha(palette.fg, 0.45),
    };
  }
  if (kind === "bối cảnh") {
    return {
      textDecorationLine: "underline" as const,
      textDecorationStyle: "dashed" as const,
      textDecorationColor: withAlpha(palette.fg, 0.35),
    };
  }
  return {
    textDecorationLine: "underline" as const,
    textDecorationStyle: "dotted" as const,
    textDecorationColor: withAlpha(palette.fg, 0.55),
    backgroundColor: withAlpha(palette.fg, 0.06),
  };
}

function AnnotatedParagraph({
  value,
  tokens: tokensProp,
  notes,
  palette,
  fontSize,
  role = "paragraph",
  level,
  onPressNote,
  onPressParagraph,
  onPressParagraphIn,
  onPressParagraphOut,
}: {
  value: string;
  tokens?: ReturnType<typeof annotateInlineTokens>;
  notes: ReaderNote[];
  palette: { fg: string };
  fontSize: number;
  role?: ReaderRenderRole;
  level?: number;
  onPressNote: (noteId: string) => void;
  onPressParagraph: () => void;
  onPressParagraphIn?: () => void;
  onPressParagraphOut?: () => void;
}) {
  const tokens = tokensProp ?? annotateInlineTokens(value, notes);
  const byId = new Map(notes.map((note) => [note.id, note]));
  const headingScale =
    role === "heading" ? Math.max(1.05, 1.45 - 0.08 * Math.min(4, Math.max(1, level || 1))) : 1;
  const isVerse = role === "verse";
  return (
    <Text
      accessibilityRole="text"
      style={{
        color: palette.fg,
        fontSize: fontSize * headingScale,
        lineHeight: fontSize * (isVerse ? 1.55 : 1.7),
        fontWeight: role === "heading" ? "700" : "400",
        fontStyle:
          role === "blockquote" || role === "stage_direction" || role === "synopsis"
            ? "italic"
            : "normal",
        marginLeft: role === "blockquote" ? 12 : 0,
        paddingLeft: role === "blockquote" ? 10 : 0,
        borderLeftWidth: role === "blockquote" ? 2 : 0,
        borderLeftColor: role === "blockquote" ? withAlpha(palette.fg, 0.25) : "transparent",
      }}
    >
      {tokens.map((token, index) => {
        const note = token.noteId ? byId.get(token.noteId) : undefined;
        return (
          <Text
            key={`${index}-${token.text}`}
            suppressHighlighting={!token.noteId}
            onPress={
              token.noteId
                ? () => onPressNote(token.noteId!)
                : onPressParagraph
            }
            onPressIn={token.noteId ? undefined : onPressParagraphIn}
            onPressOut={token.noteId ? undefined : onPressParagraphOut}
            style={[
              token.bold && styles.inlineBold,
              token.italic && styles.inlineItalic,
              note ? noteStyle(note.group_label, palette) : null,
            ]}
          >
            {token.text}
          </Text>
        );
      })}
    </Text>
  );
}

function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const NAV_HIT_SLOP = { top: 12, bottom: 12, left: 10, right: 10 } as const;

function chip(fg: string) {
  return {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: withAlpha(fg, 0.08),
    flexShrink: 0,
  } as const;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  reader: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barBrand: { fontSize: 18, fontWeight: "700" },
  barControls: {
    flexDirection: "row",
    flexShrink: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 6,
  },
  chipText: { flexShrink: 0, fontSize: 14 },
  chipTextStrong: { fontWeight: "600" },
  speechBar: {
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speechLabel: { fontSize: 13, fontWeight: "600" },
  speechControls: { flexDirection: "row", alignItems: "center", gap: 6 },
  readerBody: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },
  readerEyebrow: { fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  readerTitle: { fontSize: 26, marginTop: 8 },
  readerMeta: { fontSize: 13, marginTop: 6 },
  paragraphs: { gap: 18, marginTop: 24 },
  paragraph: { borderRadius: 8, marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 3 },
  // Break out of readerBody padding (20) → ~12px from screen edges.
  figure: { gap: 8, marginHorizontal: -8, alignSelf: "stretch" },
  figureImage: { width: "100%", borderRadius: 0 },
  figureCaption: {
    textAlign: "center",
    fontStyle: "italic",
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  speechError: { fontSize: 12, marginTop: 12 },
  chapterToast: {
    position: "absolute",
    top: 108,
    left: 20,
    right: 20,
    zIndex: 20,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  chapterToastEyebrow: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  chapterToastTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginTop: 4,
  },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pagesFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    minHeight: 36,
  },
  pagesFooterSide: {
    flex: 1,
    minHeight: 36,
    justifyContent: "center",
  },
  pagesFooterSideRight: {
    alignItems: "flex-end",
  },
  pagesPageLabel: {
    position: "absolute",
    left: 0,
    right: 0,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  navHit: {
    minHeight: 36,
    minWidth: 80,
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  navText: { fontSize: 15 },
  lockedWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  lockedTitle: { fontSize: 22, fontWeight: "600", marginTop: 8 },
  lockedBody: { textAlign: "center", lineHeight: 22, marginBottom: 8 },
  primaryBtn: {
    backgroundColor: colors.sage,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  linkBtn: { paddingVertical: 8 },
  linkText: { textDecorationLine: "underline" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  modalSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: "75%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "600" },
  tocRow: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10 },
  tocLocked: { opacity: 0.5 },
  tocLockedLabel: { fontSize: 12, marginTop: 2 },
  inlineBold: { fontWeight: "700" },
  inlineItalic: { fontStyle: "italic" },
});
