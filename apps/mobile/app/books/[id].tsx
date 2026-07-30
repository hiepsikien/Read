import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ApiError,
  type BookDetail,
  type ChapterListItem,
  type ReportReason,
} from "@read/api-client";
import { BookCover } from "../../components/BookCover";
import { useAuth } from "../../lib/auth";
import { colors, estimateMinutes, formatPrice, radii, shadows, space } from "../../lib/theme";

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
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("inappropriate");
  const [reportDetails, setReportDetails] = useState("");
  const [reporting, setReporting] = useState(false);
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

  async function submitReport() {
    if (!user) {
      router.push("/login");
      return;
    }
    if (reportReason === "other" && reportDetails.trim().length < 3) {
      Alert.alert("Add details", "Please briefly describe the issue.");
      return;
    }
    setReporting(true);
    try {
      await api.reportBook(id!, { reason: reportReason, details: reportDetails.trim() });
      setShowReport(false);
      setReportDetails("");
      Alert.alert("Report received", "An admin will review this book.");
    } catch (err) {
      Alert.alert("Could not report", err instanceof ApiError ? err.message : "Try again.");
    } finally {
      setReporting(false);
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
  const coverUrl = api.bookCoverUrl(book.cover_url);
  const readLabel = owned
    ? firstChapter
      ? "Start reading"
      : "No chapters yet"
    : "Read chapter 1 free";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: book.title }} />

      <View style={styles.hero}>
        <BookCover
          title={book.title}
          categorySlug={book.category?.slug}
          categoryLabel={book.category?.label}
          coverUrl={coverUrl}
          width={148}
          height={222}
          style={styles.cover}
        />
        <View style={styles.heroCopy}>
          {book.category ? (
            <View style={styles.categoryPill}>
              <Text style={styles.categoryPillText}>{book.category.label}</Text>
            </View>
          ) : null}
          <Text style={styles.title}>{book.title}</Text>
          {book.publisher_handle ? (
            <Pressable onPress={() => router.push(`/@${book.publisher_handle}`)} hitSlop={6}>
              <Text style={[styles.publisher, styles.publisherLink]}>{book.publisher_name}</Text>
            </Pressable>
          ) : (
            <Text style={styles.publisher}>{book.publisher_name}</Text>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{formatPrice(book.price_cents)}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.meta}>
              {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
            </Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.meta}>~{estimateMinutes(totalWords)} min</Text>
          </View>
          {book.status === "draft" ? <Text style={styles.draft}>Draft</Text> : null}
        </View>
      </View>

      {book.description ? <Text style={styles.description}>{book.description}</Text> : null}

      <View style={styles.actions}>
        {firstChapter ? (
          <Pressable
            style={styles.primaryBtn}
            onPress={() => router.push(`/read/${book.id}/${firstChapter.id}`)}
          >
            <Text style={styles.primaryBtnText}>{readLabel}</Text>
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

      {!access.isPublisherOwner ? (
        <View style={styles.reportSection}>
          <Pressable
            onPress={() => {
              if (!user) router.push("/login");
              else setShowReport((value) => !value);
            }}
          >
            <Text style={styles.reportLink}>
              {showReport ? "Cancel report" : user ? "Report this book" : "Sign in to report"}
            </Text>
          </Pressable>
          {showReport ? (
            <View style={styles.reportCard}>
              <Text style={styles.reportTitle}>What is the issue?</Text>
              <View style={styles.reasonRow}>
                {(
                  [
                    "copyright",
                    "inappropriate",
                    "spam",
                    "misleading",
                    "other",
                  ] as ReportReason[]
                ).map((reason) => (
                  <Pressable
                    key={reason}
                    style={[
                      styles.reasonChip,
                      reportReason === reason && styles.reasonChipActive,
                    ]}
                    onPress={() => setReportReason(reason)}
                  >
                    <Text
                      style={[
                        styles.reasonText,
                        reportReason === reason && styles.reasonTextActive,
                      ]}
                    >
                      {reason}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.reportInput}
                value={reportDetails}
                onChangeText={setReportDetails}
                placeholder="Additional details"
                placeholderTextColor={colors.inkSoft}
                multiline
              />
              <Pressable
                style={[styles.reportSubmit, reporting && styles.disabled]}
                disabled={reporting}
                onPress={() => void submitReport()}
              >
                <Text style={styles.reportSubmitText}>
                  {reporting ? "Sending…" : "Submit report"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.section}>Chapters</Text>
      <View style={styles.chapterList}>
        {chapters.map((chapter, index) => {
          const locked = !owned && book.price_cents > 0 && chapter.group_index > 1;
          return (
            <Pressable
              key={chapter.id}
              disabled={locked}
              style={[styles.chapterRow, index === chapters.length - 1 && styles.chapterRowLast]}
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
  container: { padding: space.xl, gap: space.md, paddingBottom: 56 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mist,
  },
  hero: {
    flexDirection: "row",
    gap: space.lg,
    alignItems: "flex-start",
  },
  cover: { ...shadows.soft },
  heroCopy: { flex: 1, gap: 8, paddingTop: 4 },
  categoryPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(63,111,92,0.12)",
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryPillText: {
    color: colors.sageDeep,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: { fontSize: 26, fontWeight: "700", color: colors.ink, lineHeight: 30 },
  publisher: { color: colors.inkSoft, fontSize: 14 },
  publisherLink: { color: colors.sage, textDecorationLine: "underline" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  meta: { color: colors.inkSoft, fontSize: 13 },
  metaDot: { color: colors.line },
  draft: { color: "#9a6a00", fontSize: 13, fontWeight: "600" },
  description: { color: colors.inkSoft, lineHeight: 22 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  primaryBtn: {
    backgroundColor: colors.sage,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: radii.sm,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  buyBtn: {
    backgroundColor: colors.ink,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: radii.sm,
    minWidth: 120,
    alignItems: "center",
  },
  buyBtnText: { color: colors.paper, fontWeight: "700" },
  hint: { color: colors.inkSoft, fontSize: 13 },
  reportSection: { marginTop: 4, gap: 10 },
  reportLink: {
    color: colors.inkSoft,
    fontSize: 13,
    textDecorationLine: "underline",
  },
  reportCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
  },
  reportTitle: { color: colors.ink, fontWeight: "700" },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  reasonChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reasonChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  reasonText: { color: colors.inkSoft, fontSize: 11, textTransform: "capitalize" },
  reasonTextActive: { color: colors.white },
  reportInput: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    padding: 10,
    color: colors.ink,
    textAlignVertical: "top",
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  reportSubmit: {
    alignSelf: "flex-start",
    backgroundColor: colors.ink,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  reportSubmitText: { color: colors.white, fontWeight: "600" },
  disabled: { opacity: 0.55 },
  section: {
    marginTop: space.md,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "700",
  },
  chapterList: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
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
  chapterRowLast: { borderBottomWidth: 0 },
  chapterInfo: { gap: 3 },
  chapterTitle: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  chapterMeta: { color: colors.inkSoft, fontSize: 12 },
  locked: { opacity: 0.55 },
  error: { color: colors.danger },
});
