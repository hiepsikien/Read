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
import {
  ApiError,
  type BookDetail,
  type ChapterListItem,
} from "@read/api-client";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors, formatPrice } from "../../lib/theme";

export default function ManageBookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api } = useAuth();

  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [busy, setBusy] = useState<"" | "save" | "split" | "publish">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const data = await api.getBook(id);
      setBook(data.book);
      setChapters(data.chapters);
      setTitle(data.book.title);
      setDescription(data.book.description);
      setPricing(data.book.price_cents > 0 ? "paid" : "free");
      setPrice(((data.book.price_cents || 499) / 100).toFixed(2));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load book.");
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function saveMeta() {
    setBusy("save");
    setMessage("");
    setError("");
    try {
      await api.updateBook(id!, { title, description, pricing, price: Number(price) });
      setMessage("Details saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy("");
    }
  }

  async function split() {
    setBusy("split");
    setMessage("");
    setError("");
    try {
      const payload = await api.splitBook(id!);
      setMessage(`Created ${payload.chapter_count} chapters.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Split failed.");
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    setBusy("publish");
    setMessage("");
    setError("");
    try {
      await api.publishBook(id!);
      setMessage("Book published to the library.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed.");
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
      <Stack.Screen options={{ title: book.title }} />
      <Text style={styles.title}>{book.title}</Text>
      <Text style={styles.sub}>
        {book.status} · {formatPrice(book.price_cents)}
        {book.source_filename ? ` · ${book.source_filename}` : ""}
      </Text>

      <Text style={styles.section}>Details</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Title"
        placeholderTextColor={colors.inkSoft}
      />
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="Description"
        placeholderTextColor={colors.inkSoft}
        multiline
      />
      <View style={styles.pricingRow}>
        <Pressable
          style={[styles.choice, pricing === "free" && styles.choiceActive]}
          onPress={() => setPricing("free")}
        >
          <Text style={[styles.choiceText, pricing === "free" && styles.choiceTextActive]}>Free</Text>
        </Pressable>
        <Pressable
          style={[styles.choice, pricing === "paid" && styles.choiceActive]}
          onPress={() => setPricing("paid")}
        >
          <Text style={[styles.choiceText, pricing === "paid" && styles.choiceTextActive]}>Paid</Text>
        </Pressable>
      </View>
      {pricing === "paid" ? (
        <TextInput
          style={styles.input}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="4.99"
          placeholderTextColor={colors.inkSoft}
        />
      ) : null}
      <Pressable
        style={[styles.secondaryBtn, styles.saveBtn]}
        onPress={saveMeta}
        disabled={busy === "save"}
      >
        <Text style={styles.secondaryBtnText}>{busy === "save" ? "Saving…" : "Save details"}</Text>
      </Pressable>

      <Text style={styles.section}>Chapters</Text>
      <Text style={styles.hint}>
        Detects chapters and sections, then packs them into comfortable reading segments.
      </Text>
      <Pressable
        style={[styles.primaryBtn, !book.has_raw_text && styles.disabled]}
        onPress={split}
        disabled={!book.has_raw_text || busy === "split"}
      >
        <Text style={styles.primaryBtnText}>
          {busy === "split" ? "Splitting…" : "Auto-split into reading segments"}
        </Text>
      </Pressable>

      <View style={styles.list}>
        {chapters.length === 0 ? (
          <Text style={styles.meta}>No chapters yet.</Text>
        ) : (
          chapters.map((chapter) => (
            <View key={chapter.id} style={styles.row}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {chapter.title}
              </Text>
              <Text style={styles.rowMeta}>{chapter.word_count} words</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.publishRow}>
        <Pressable
          style={[styles.publishBtn, chapters.length === 0 && styles.disabled]}
          onPress={publish}
          disabled={chapters.length === 0 || busy === "publish"}
        >
          <Text style={styles.publishBtnText}>
            {busy === "publish" ? "Publishing…" : "Publish to library"}
          </Text>
        </Pressable>
        {book.status === "published" && chapters[0] ? (
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => router.push(`/read/${book.id}/${chapters[0].id}`)}
          >
            <Text style={styles.secondaryBtnText}>Open reader</Text>
          </Pressable>
        ) : null}
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
  sub: { color: colors.inkSoft, marginTop: 4 },
  section: {
    marginTop: 20,
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
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
  pricingRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  choiceActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  choiceText: { color: colors.ink, fontWeight: "600" },
  choiceTextActive: { color: "#fff" },
  hint: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  saveBtn: { marginTop: 12 },
  secondaryBtnText: { color: colors.ink, fontWeight: "600" },
  list: {
    marginTop: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowTitle: { color: colors.ink, flex: 1 },
  rowMeta: { color: colors.inkSoft, fontSize: 13 },
  meta: { color: colors.inkSoft, padding: 14 },
  publishRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16, alignItems: "center" },
  publishBtn: {
    backgroundColor: colors.ink,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  publishBtnText: { color: colors.paper, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  success: { color: colors.sageDeep, marginTop: 12 },
  error: { color: colors.danger, marginTop: 12 },
});
