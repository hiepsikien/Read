import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type BookDetail, type ChapterListItem } from "@read/api-client";
import { useAuth } from "../../lib/auth";
import { colors, estimateMinutes, formatPrice } from "../../lib/theme";

type Access = {
  owned: boolean;
  isPublisherOwner: boolean;
  previewChapterId: string | null;
};

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, api } = useAuth();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const data = await api.getBook(id);
      setBook(data.book);
      setChapters(data.chapters);
      setAccess(data.access);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load book.");
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function purchase() {
    if (!user) {
      router.push("/login");
      return;
    }
    setBuying(true);
    try {
      await api.purchaseBook(id!);
      await load();
      Alert.alert("Purchase complete", "The full book is unlocked (mock purchase).");
    } catch (err) {
      Alert.alert("Purchase failed", err instanceof ApiError ? err.message : "Try again.");
    } finally {
      setBuying(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  if (error || !book || !access) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error || "Book unavailable."}</Text>
      </View>
    );
  }

  const owned = access.owned;
  const firstChapter = chapters[0];
  const totalWords = chapters.reduce((sum, c) => sum + c.word_count, 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: book.title }} />
      <Text style={styles.eyebrow}>{book.publisher_name}</Text>
      <Text style={styles.title}>{book.title}</Text>
      <Text style={styles.description}>{book.description}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{formatPrice(book.price_cents)}</Text>
        <Text style={styles.meta}>
          {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
        </Text>
        <Text style={styles.meta}>~{estimateMinutes(totalWords)} min</Text>
        {book.status === "draft" ? <Text style={styles.draft}>Draft</Text> : null}
      </View>

      <View style={styles.actions}>
        {firstChapter ? (
          <Pressable
            style={styles.primaryBtn}
            onPress={() => router.push(`/read/${book.id}/${firstChapter.id}`)}
          >
            <Text style={styles.primaryBtnText}>
              {owned ? "Continue reading" : "Read chapter 1 free"}
            </Text>
          </Pressable>
        ) : null}
        {!owned && book.price_cents > 0 ? (
          <Pressable style={styles.buyBtn} onPress={purchase} disabled={buying}>
            {buying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buyBtnText}>Buy · {formatPrice(book.price_cents)}</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {!owned && book.price_cents > 0 ? (
        <Text style={styles.hint}>
          The whole first chapter is free inside Read. Purchase unlocks the rest.
        </Text>
      ) : null}

      <Text style={styles.section}>Chapters</Text>
      <View style={styles.chapterList}>
        {chapters.map((chapter) => {
          const locked = !owned && book.price_cents > 0 && chapter.group_index > 1;
          return (
            <Pressable
              key={chapter.id}
              disabled={locked}
              style={styles.chapterRow}
              onPress={() => router.push(`/read/${book.id}/${chapter.id}`)}
            >
              <View style={styles.chapterInfo}>
                <Text style={[styles.chapterTitle, locked && styles.locked]} numberOfLines={1}>
                  {chapter.title}
                </Text>
                <Text style={styles.chapterMeta}>
                  {locked ? "Locked · purchase to read" : `${estimateMinutes(chapter.word_count)} min`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10, paddingBottom: 48 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.sage,
    fontWeight: "600",
  },
  title: { fontSize: 30, fontWeight: "700", color: colors.ink, marginTop: 4 },
  description: { color: colors.inkSoft, lineHeight: 22, marginTop: 6 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 },
  meta: { color: colors.inkSoft, fontSize: 14 },
  draft: { color: "#9a6a00", fontSize: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  primaryBtn: {
    backgroundColor: colors.sage,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  buyBtn: {
    backgroundColor: colors.ink,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  buyBtnText: { color: colors.paper, fontWeight: "600" },
  hint: { color: colors.inkSoft, fontSize: 13, marginTop: 8 },
  section: {
    marginTop: 20,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
  chapterList: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  chapterRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  chapterInfo: { gap: 3 },
  chapterTitle: { color: colors.ink, fontSize: 15 },
  chapterMeta: { color: colors.inkSoft, fontSize: 12 },
  locked: { opacity: 0.55 },
  error: { color: colors.danger },
});
