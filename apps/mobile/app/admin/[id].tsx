import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
  type ModerationEvent,
} from "@read/api-client";
import { BookCover } from "../../components/BookCover";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors, formatPrice } from "../../lib/theme";

export default function AdminReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, api, loading: authLoading } = useAuth();
  const [book, setBook] = useState<(BookDetail & { publisher_name: string }) | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [history, setHistory] = useState<ModerationEvent[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const data = await api.adminBook(id);
      setBook(data.book);
      setChapters(data.chapters);
      setHistory(data.moderation_history);
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

  async function approve(featured = false) {
    setBusy(featured ? "approve_featured" : "approve");
    setError("");
    setMessage("");
    try {
      await api.adminApprove(id!, featured);
      setMessage(featured ? "Book approved and featured." : "Book approved and published.");
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed.");
    } finally {
      setBusy("");
    }
  }

  async function setFeatured(featured: boolean) {
    setBusy(featured ? "feature" : "unfeature");
    setError("");
    try {
      await api.adminSetFeatured(id!, featured);
      setMessage(featured ? "Book featured." : "Book removed from Featured.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Feature update failed.");
    } finally {
      setBusy("");
    }
  }

  async function setVisibility(visibility: "listed" | "hidden" | "removed") {
    if (visibility !== "listed" && note.trim().length < 3) {
      setError("Add a moderation note before hiding or removing a book.");
      return;
    }
    setBusy(visibility);
    setError("");
    try {
      await api.adminSetVisibility(id!, visibility, note.trim());
      setMessage(
        visibility === "listed"
          ? "Book relisted."
          : visibility === "hidden"
            ? "Book hidden from the Library."
            : "Book removed."
      );
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Visibility update failed.");
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
      <View style={styles.hero}>
        <BookCover
          title={book.title}
          categorySlug={book.category?.slug}
          categoryLabel={book.category?.label}
          coverUrl={book.status === "published" ? api.bookCoverUrl(book.cover_url) : null}
          width={100}
          height={150}
        />
        <View style={styles.heroCopy}>
          <Text style={styles.title}>{book.title}</Text>
          <Text style={styles.sub}>
            {book.status} · {book.visibility || "listed"}
            {book.featured ? " · featured" : ""}
          </Text>
          <Text style={styles.sub}>
            {book.category?.label || "Uncategorized"} · {formatPrice(book.price_cents)}
          </Text>
          <Text style={styles.sub}>By {book.publisher_name}</Text>
          {book.report_count ? (
            <Text style={styles.reportCount}>{book.report_count} open report(s)</Text>
          ) : null}
        </View>
      </View>
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

      {book.allowed_actions?.length ? (
        <>
          <Text style={styles.section}>Moderation actions</Text>
          {(book.allowed_actions.includes("reject") ||
            book.allowed_actions.includes("hide") ||
            book.allowed_actions.includes("remove")) && (
            <>
              {book.allowed_actions.includes("reject") ? (
                <View style={styles.presets}>
                  {[
                    ["Copyright", "The manuscript may infringe copyright or publishing rights."],
                    ["Content", "The content conflicts with the Community Guidelines."],
                    ["Quality", "Please revise formatting, metadata, or chapter structure."],
                  ].map(([label, value]) => (
                    <Pressable key={label} style={styles.preset} onPress={() => setNote(value)}>
                      <Text style={styles.presetText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <TextInput
                style={[styles.input, styles.multiline]}
                value={note}
                onChangeText={setNote}
                placeholder="Moderation note"
                placeholderTextColor={colors.inkSoft}
                multiline
              />
            </>
          )}
          <View style={styles.actions}>
            {book.allowed_actions.includes("approve") ? (
              <ActionButton
                label={busy === "approve" ? "Approving…" : "Approve"}
                onPress={() => void approve(false)}
                disabled={busy !== ""}
              />
            ) : null}
            {book.allowed_actions.includes("approve_featured") ? (
              <ActionButton
                label={busy === "approve_featured" ? "Approving…" : "Approve & Featured"}
                onPress={() => void approve(true)}
                disabled={busy !== ""}
                dark
              />
            ) : null}
            {book.allowed_actions.includes("reject") ? (
              <ActionButton
                label={busy === "reject" ? "Rejecting…" : "Reject"}
                onPress={() => void reject()}
                disabled={busy !== ""}
                danger
              />
            ) : null}
            {book.allowed_actions.includes("feature") ? (
              <ActionButton label="Feature" onPress={() => void setFeatured(true)} disabled={busy !== ""} />
            ) : null}
            {book.allowed_actions.includes("unfeature") ? (
              <ActionButton label="Unfeature" onPress={() => void setFeatured(false)} disabled={busy !== ""} />
            ) : null}
            {book.allowed_actions.includes("hide") ? (
              <ActionButton label="Hide" onPress={() => void setVisibility("hidden")} disabled={busy !== ""} danger />
            ) : null}
            {book.allowed_actions.includes("relist") ? (
              <ActionButton label="Relist" onPress={() => void setVisibility("listed")} disabled={busy !== ""} />
            ) : null}
            {book.allowed_actions.includes("remove") ? (
              <ActionButton
                label="Remove"
                onPress={() =>
                  Alert.alert("Remove book permanently?", "This cannot be restored in Admin.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: () => void setVisibility("removed") },
                  ])
                }
                disabled={busy !== ""}
                danger
              />
            ) : null}
          </View>
        </>
      ) : (
        <Text style={styles.readOnly}>No moderation actions are available for this state.</Text>
      )}

      <Text style={styles.section}>Moderation history</Text>
      <View style={styles.list}>
        {history.length === 0 ? (
          <Text style={styles.rowMeta}>No recorded events yet.</Text>
        ) : (
          history.map((event) => (
            <View key={event.id} style={styles.row}>
              <Text style={styles.rowTitle}>{event.action.replaceAll("_", " ")}</Text>
              <Text style={styles.rowMeta}>{new Date(event.created_at).toLocaleString()}</Text>
              {event.note ? <Text style={styles.preview}>{event.note}</Text> : null}
            </View>
          ))
        )}
      </View>

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormScroll>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  danger = false,
  dark = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
  dark?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.actionBtn,
        danger && styles.rejectBtn,
        dark && styles.darkBtn,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8, paddingBottom: 60 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink, marginTop: 4 },
  hero: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  heroCopy: { flex: 1, gap: 5 },
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
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  actionBtn: {
    backgroundColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  actionText: { color: "#fff", fontWeight: "600" },
  rejectBtn: {
    backgroundColor: colors.danger,
  },
  darkBtn: { backgroundColor: colors.ink },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  preset: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: colors.card,
  },
  presetText: { color: colors.inkSoft, fontSize: 12 },
  reportCount: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  readOnly: { color: colors.inkSoft, marginTop: 18, fontStyle: "italic" },
  disabled: { opacity: 0.5 },
  success: { color: colors.sageDeep, marginTop: 12 },
  error: { color: colors.danger, marginTop: 12 },
});
