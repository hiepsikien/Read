import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type BookDetail, type ChapterListItem } from "@read/api-client";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors, formatPrice } from "../../lib/theme";

export default function AdminReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, api, loading: authLoading } = useAuth();
  const [book, setBook] = useState<(BookDetail & { publisher_name: string }) | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const data = await api.adminBook(id);
      setBook(data.book);
      setChapters(data.chapters);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load book.");
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.role !== "admin") {
        router.replace("/");
        return;
      }
      void load();
    }, [authLoading, user, router, load])
  );

  async function approve() {
    setBusy("approve");
    setError("");
    setMessage("");
    try {
      await api.adminApprove(id!);
      setMessage("Book approved and published.");
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed.");
    } finally {
      setBusy("");
    }
  }

  async function reject() {
    if (note.trim().length < 3) {
      setError("Add a short rejection note for the author.");
      return;
    }
    setBusy("reject");
    setError("");
    setMessage("");
    try {
      await api.adminReject(id!, note.trim());
      setMessage("Book rejected.");
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reject failed.");
    } finally {
      setBusy("");
    }
  }

  if (!book) {
    return (
      <View style={styles.centered}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.sage} />}
      </View>
    );
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Review book" }} />
      <Text style={styles.title}>{book.title}</Text>
      <Text style={styles.sub}>
        {book.status} · {book.category?.label || "Uncategorized"} · {formatPrice(book.price_cents)}
      </Text>
      <Text style={styles.sub}>
        By {book.publisher_name}
        {book.source_filename ? ` · ${book.source_filename}` : ""}
      </Text>
      <Text style={styles.body}>{book.description || "No description provided."}</Text>

      <Text style={styles.section}>Chapters · {chapters.length}</Text>
      <View style={styles.list}>
        {chapters.map((chapter) => (
          <View key={chapter.id} style={styles.row}>
            <Text style={styles.rowTitle}>{chapter.title}</Text>
            <Text style={styles.rowMeta}>{chapter.word_count} words</Text>
            {chapter.content_preview ? (
              <Text style={styles.preview} numberOfLines={4}>
                {chapter.content_preview}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      <Text style={styles.section}>Decision</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={note}
        onChangeText={setNote}
        placeholder="Rejection note (required to reject)"
        placeholderTextColor={colors.inkSoft}
        multiline
      />
      <View style={styles.actions}>
        <Pressable
          style={[styles.approveBtn, busy !== "" && styles.disabled]}
          onPress={approve}
          disabled={busy !== ""}
        >
          <Text style={styles.approveText}>{busy === "approve" ? "Approving…" : "Approve"}</Text>
        </Pressable>
        <Pressable
          style={[styles.rejectBtn, busy !== "" && styles.disabled]}
          onPress={reject}
          disabled={busy !== ""}
        >
          <Text style={styles.rejectText}>{busy === "reject" ? "Rejecting…" : "Reject"}</Text>
        </Pressable>
      </View>

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8, paddingBottom: 60 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink, marginTop: 4 },
  sub: { color: colors.inkSoft },
  body: { color: colors.inkSoft, lineHeight: 21, marginTop: 8 },
  section: {
    marginTop: 18,
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
  list: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: {
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 4,
  },
  rowTitle: { color: colors.ink, fontWeight: "600" },
  rowMeta: { color: colors.inkSoft, fontSize: 13 },
  preview: { color: colors.inkSoft, fontSize: 13, lineHeight: 18, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.ink,
    marginTop: 6,
  },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  approveBtn: {
    flex: 1,
    backgroundColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  approveText: { color: "#fff", fontWeight: "600" },
  rejectBtn: {
    flex: 1,
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  rejectText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.5 },
  success: { color: colors.sageDeep, marginTop: 12 },
  error: { color: colors.danger, marginTop: 12 },
});
