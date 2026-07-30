import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
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
import { useAuth } from "../../../lib/auth";
import {
  colors,
  estimateMinutes,
  formatPrice,
  readerThemes,
  type ReaderThemeKey,
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
  const [fontSize, setFontSize] = useState(19);
  const [theme, setTheme] = useState<ReaderThemeKey>("paper");

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

  const neighbors = useMemo(() => {
    if (!data) return { prev: null as ChapterListItem | null, next: null as ChapterListItem | null };
    const index = data.chapters.findIndex((c) => c.id === data.chapter.id);
    return {
      prev: index > 0 ? data.chapters[index - 1] : null,
      next: index >= 0 && index < data.chapters.length - 1 ? data.chapters[index + 1] : null,
    };
  }, [data]);

  const palette = readerThemes[theme];

  function cycleTheme() {
    const keys = Object.keys(readerThemes) as ReaderThemeKey[];
    const idx = keys.indexOf(theme);
    setTheme(keys[(idx + 1) % keys.length]);
  }

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
        <Text style={[styles.lockedBrand, { color: palette.fg }]}>Read</Text>
        <Text style={[styles.lockedTitle, { color: palette.fg }]}>This chapter is locked</Text>
        <Text style={[styles.lockedBody, { color: palette.muted }]}>
          Chapter 1 is free. Unlock the full book with a mock purchase to keep reading.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={buy}>
          <Text style={styles.primaryBtnText}>Buy · {formatPrice(priceCents)}</Text>
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={() => router.replace(`/books/${bookId}`)}>
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

  // Native text renders every newline as a hard break, so collapse the soft
  // line wrapping that survives inside a paragraph.
  const paragraphs = data.chapter.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  return (
    <SafeAreaView style={[styles.reader, { backgroundColor: palette.bg }]} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.bar, { borderBottomColor: withAlpha(palette.fg, 0.12) }]}>
        <Pressable onPress={() => router.replace(`/books/${bookId}`)}>
          <Text style={[styles.barBrand, { color: palette.fg }]}>Read</Text>
        </Pressable>
        <View style={styles.barControls}>
          <Pressable style={chip(palette.fg)} onPress={() => setFontSize((s) => Math.max(15, s - 2))}>
            <Text style={{ color: palette.fg }}>A−</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={() => setFontSize((s) => Math.min(28, s + 2))}>
            <Text style={{ color: palette.fg }}>A+</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={cycleTheme}>
            <Text style={{ color: palette.fg }}>{palette.label}</Text>
          </Pressable>
          <Pressable style={chip(palette.fg)} onPress={() => setTocOpen(true)}>
            <Text style={{ color: palette.fg, fontWeight: "600" }}>Contents</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.readerBody}>
        <Text style={[styles.readerEyebrow, { color: palette.muted }]}>{data.book.title}</Text>
        <Text style={[styles.readerTitle, { color: palette.fg }]}>{data.chapter.title}</Text>
        <Text style={[styles.readerMeta, { color: palette.muted }]}>
          {estimateMinutes(data.chapter.word_count)} min · Chapter {data.chapter.position} of{" "}
          {data.chapters.length}
        </Text>

        <View style={styles.paragraphs}>
          {paragraphs.map((paragraph, index) => (
            <Text
              key={index}
              style={{ color: palette.fg, fontSize, lineHeight: fontSize * 1.7 }}
            >
              <InlineMarkdown value={paragraph} />
            </Text>
          ))}
        </View>

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
            <Pressable onPress={() => router.replace(`/books/${bookId}`)}>
              <Text style={[styles.navText, { color: palette.fg }]}>Done</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

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
  readerBody: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },
  readerEyebrow: { fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  readerTitle: { fontSize: 26, fontWeight: "700", marginTop: 8 },
  readerMeta: { fontSize: 13, marginTop: 6 },
  paragraphs: { gap: 18, marginTop: 24 },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navText: { fontSize: 15 },
  lockedWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  lockedBrand: { fontSize: 24, fontWeight: "700" },
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
