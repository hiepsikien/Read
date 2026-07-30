import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  ApiError,
  parseInlineMarkdown,
  type ChapterListItem,
} from "@read/api-client";
import { BrandLogo } from "../../../components/BrandLogo";
import { ExplainSheet } from "../../../components/ExplainSheet";
import { useAuth } from "../../../lib/auth";
import {
  FONT_SIZE_STEP,
  useReaderPreferences,
} from "../../../lib/reader-preferences";
import { useIosNarration } from "../../../lib/use-ios-narration";
import { VoicePickerModal } from "../../../lib/voice-picker";
import {
  colors,
  estimateMinutes,
  formatPrice,
  readerThemes,
} from "../../../lib/theme";

type ReaderPayload = {
  book: { id: string; title: string; price_cents: number; publisher_name: string };
  chapter: { id: string; position: number; title: string; content: string; word_count: number };
  chapters: ChapterListItem[];
};

export default function ReaderScreen() {
  const { bookId, chapterId } = useLocalSearchParams<{ bookId: string; chapterId: string }>();
  const router = useRouter();
  const { user, api } = useAuth();

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
  const { fontSize, theme, changeFontSize, cycleTheme } = useReaderPreferences();

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<ViewType>(null);
  const paragraphRefs = useRef<Array<ViewType | null>>([]);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  // Follow the spoken paragraph until the reader manually scrolls away.
  const followNarrationRef = useRef(true);

  const load = useCallback(async () => {
    if (!bookId || !chapterId) return;
    setLoading(true);
    setError("");
    setLocked(false);
    try {
      const payload = await api.getChapter(bookId, chapterId);
      setData(payload);
      await SecureStore.setItemAsync(`read_pos_${bookId}`, chapterId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        const body = err.body as { book?: { price_cents?: number } };
        setLocked(true);
        setPriceCents(body.book?.price_cents ?? 0);
        setData(null);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not load chapter.");
      }
    } finally {
      setLoading(false);
    }
  }, [api, bookId, chapterId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
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

  // The book screen is already one level down in the stack, so popping avoids
  // pushing a second copy of it that would need two back presses to clear.
  const leaveReader = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/books/${bookId}`);
  }, [router, bookId]);

  const neighbors = useMemo(() => {
    if (!data) return { prev: null as ChapterListItem | null, next: null as ChapterListItem | null };
    const index = data.chapters.findIndex((c) => c.id === data.chapter.id);
    return {
      prev: index > 0 ? data.chapters[index - 1] : null,
      next: index >= 0 && index < data.chapters.length - 1 ? data.chapters[index + 1] : null,
    };
  }, [data]);

  // Native text renders every newline as a hard break, so collapse the soft
  // line wrapping that survives inside a paragraph.
  const paragraphs = useMemo(
    () =>
      (data?.chapter.content ?? "")
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
        .filter(Boolean),
    [data?.chapter.content]
  );
  const speech = useIosNarration({ api, bookId, chapterId, paragraphs });

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

  useEffect(() => {
    if (speech.playbackState !== "speaking") return;
    if (speech.currentParagraph === null) return;
    scrollSpokenParagraphIntoView(speech.currentParagraph);
  }, [speech.currentParagraph, speech.playbackState, scrollSpokenParagraphIntoView]);

  const onReaderScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
    viewportHeightRef.current = event.nativeEvent.layoutMeasurement.height;
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        void speech.stop();
      };
    }, [speech.stop])
  );

  const palette = readerThemes[theme];
  const brandTone = theme === "ink" ? "white" : "color";

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  if (locked) {
    return (
      <SafeAreaView style={[styles.lockedWrap, { backgroundColor: palette.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
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
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: palette.fg }}>{error || "Chapter unavailable."}</Text>
        <Pressable style={styles.linkBtn} onPress={() => router.replace("/")}>
          <Text style={[styles.linkText, { color: colors.sage }]}>Back to library</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.reader, { backgroundColor: palette.bg }]} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.bar, { borderBottomColor: withAlpha(palette.fg, 0.12) }]}>
        <Pressable onPress={leaveReader} accessibilityLabel="Back to book">
          <BrandLogo variant="mark" height={26} tone={brandTone} />
        </Pressable>
        <View style={styles.barControls}>
          <Pressable style={chip(palette.fg)} onPress={() => changeFontSize(-FONT_SIZE_STEP)}>
            <Text style={{ color: palette.fg }}>A−</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={() => changeFontSize(FONT_SIZE_STEP)}>
            <Text style={{ color: palette.fg }}>A+</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={cycleTheme}>
            <Text style={{ color: palette.fg }}>{palette.label}</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={() => setTocOpen(true)}>
            <Text style={{ color: palette.fg, fontWeight: "600" }}>Contents</Text>
          </Pressable>
          <Pressable
            style={chip(palette.fg)}
            accessibilityRole="button"
            accessibilityLabel="Ask about a name in this chapter"
            onPress={() => {
              setExplainMode("ask");
              setExplainParagraph(null);
              setExplainOpen(true);
            }}
          >
            <Text style={{ color: palette.fg, fontWeight: "600" }}>Ask</Text>
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
                void speech.togglePlayback();
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
                onPress={() => void speech.stop()}
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

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.readerBody}
        onScroll={onReaderScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          followNarrationRef.current = false;
        }}
      >
        <View ref={contentRef} collapsable={false}>
          <Text style={[styles.readerEyebrow, { color: palette.muted }]}>{data.book.title}</Text>
          <Text style={[styles.readerTitle, { color: palette.fg }]}>{data.chapter.title}</Text>
          <Text style={[styles.readerMeta, { color: palette.muted }]}>
            {estimateMinutes(data.chapter.word_count)} min · Chapter {data.chapter.position} of{" "}
            {data.chapters.length}
          </Text>

          <View style={styles.paragraphs}>
            {paragraphs.map((paragraph, index) => (
              <View
                key={index}
                ref={(node) => {
                  paragraphRefs.current[index] = node;
                }}
                collapsable={false}
                style={[
                  styles.paragraph,
                  speech.currentParagraph === index && {
                    backgroundColor: withAlpha(palette.fg, 0.08),
                  },
                ]}
              >
                <Pressable
                  onLongPress={() => {
                    setExplainMode("result");
                    setExplainParagraph(index);
                    setExplainOpen(true);
                  }}
                  delayLongPress={350}
                >
                  <Text style={{ color: palette.fg, fontSize, lineHeight: fontSize * 1.7 }}>
                    <InlineMarkdown value={paragraph} />
                  </Text>
                </Pressable>
              </View>
            ))}
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
              <Pressable onPress={leaveReader}>
                <Text style={[styles.navText, { color: palette.fg }]}>Done</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>

      <ExplainSheet
        visible={explainOpen}
        mode={explainMode}
        api={api}
        bookId={bookId!}
        chapterId={chapterId!}
        palette={palette}
        paragraphIndex={explainParagraph}
        onClose={() => setExplainOpen(false)}
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
          <ScrollView>
            {data.chapters.map((chapter) => {
              const active = chapter.id === data.chapter.id;
              return (
                <Pressable
                  key={chapter.id}
                  disabled={chapter.locked}
                  style={[
                    styles.tocRow,
                    active && { backgroundColor: withAlpha(palette.fg, 0.08) },
                  ]}
                  onPress={() => {
                    setTocOpen(false);
                    router.replace(`/read/${bookId}/${chapter.id}`);
                  }}
                >
                  <Text style={[{ color: palette.fg }, chapter.locked && styles.tocLocked]}>
                    {chapter.title}
                  </Text>
                  {chapter.locked ? (
                    <Text style={[styles.tocLockedLabel, { color: palette.muted }]}>Locked</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InlineMarkdown({ value }: { value: string }) {
  return (
    <>
      {parseInlineMarkdown(value).map((token, index) => (
        <Text
          key={`${index}-${token.text}`}
          style={[
            token.bold && styles.inlineBold,
            token.italic && styles.inlineItalic,
          ]}
        >
          {token.text}
        </Text>
      ))}
    </>
  );
}

function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function chip(fg: string) {
  return {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: withAlpha(fg, 0.08),
  } as const;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  reader: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barBrand: { fontSize: 18, fontWeight: "700" },
  barControls: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  readerTitle: { fontSize: 26, fontWeight: "700", marginTop: 8 },
  readerMeta: { fontSize: 13, marginTop: 6 },
  paragraphs: { gap: 18, marginTop: 24 },
  paragraph: { borderRadius: 8, marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 3 },
  speechError: { fontSize: 12, marginTop: 12 },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
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
