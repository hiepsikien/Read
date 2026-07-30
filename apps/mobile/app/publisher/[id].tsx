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
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  ApiError,
  SPLIT_LENGTH_OPTIONS,
  type BookDetail,
  type Category,
  type ChapterListItem,
  type SplitLength,
} from "@read/api-client";
import { BookCover } from "../../components/BookCover";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors, formatPrice } from "../../lib/theme";

export default function ManageBookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api } = useAuth();

  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [categoryId, setCategoryId] = useState("");
  const [splitLength, setSplitLength] = useState<SplitLength>("standard");
  const [busy, setBusy] = useState<"" | "save" | "split" | "submit" | "cover" | "glossary">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [glossaryCount, setGlossaryCount] = useState<number | null>(null);

  const locked = book?.status === "pending_review" || book?.status === "published";

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const [data, categoryPayload] = await Promise.all([
        api.getBook(id),
        api.listCategories(),
      ]);
      setBook(data.book);
      setChapters(data.chapters);
      setCategories(categoryPayload.categories);
      setTitle(data.book.title);
      setDescription(data.book.description);
      setPricing(data.book.price_cents > 0 ? "paid" : "free");
      setPrice(((data.book.price_cents || 499) / 100).toFixed(2));
      setCategoryId(data.book.category?.id || categoryPayload.categories[0]?.id || "");
      try {
        const glossary = await api.listGlossary(id);
        setGlossaryCount(glossary.count);
      } catch {
        setGlossaryCount(null);
      }
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
      await api.updateBook(id!, {
        title,
        description,
        pricing,
        price: Number(price),
        category_id: categoryId,
      });
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
      const payload = await api.splitBook(id!, { length: splitLength });
      setMessage(`Created ${payload.chapter_count} chapters.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Split failed.");
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    setBusy("submit");
    setMessage("");
    setError("");
    try {
      await api.submitReview(id!);
      setMessage("Submitted for admin review.");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.message === "terms_required") {
        router.push(`/legal/accept?action=submit&bookId=${id}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Submit failed.");
    } finally {
      setBusy("");
    }
  }

  async function replaceCover() {
    if (locked) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsEditing: true,
      aspect: [2, 3],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setBusy("cover");
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", {
        uri: asset.uri,
        name: asset.fileName || "cover.jpg",
        type: asset.mimeType || "image/jpeg",
      } as unknown as Blob);
      await api.uploadBookCover(id!, form);
      setMessage("Cover updated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cover upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function uploadGlossary() {
    if (locked) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "org.openxmlformats.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setBusy("glossary");
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", {
        uri: asset.uri,
        name: asset.name || "glossary.docx",
        type:
          asset.mimeType ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      } as unknown as Blob);
      const payload = await api.uploadGlossary(id!, form);
      setMessage(`Imported ${payload.count} character notes.`);
      setGlossaryCount(payload.count);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Glossary upload failed.");
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
      <View style={styles.coverRow}>
        <BookCover
          title={book.title}
          categorySlug={book.category?.slug}
          categoryLabel={book.category?.label}
          coverUrl={api.bookCoverUrl(book.cover_url)}
          width={110}
          height={165}
        />
        <View style={styles.coverMeta}>
          <Text style={styles.title}>{book.title}</Text>
          <Text style={styles.sub}>
            {book.status} · {formatPrice(book.price_cents)}
            {book.category ? ` · ${book.category.label}` : ""}
            {book.source_filename ? ` · ${book.source_filename}` : ""}
          </Text>
          <Pressable
            style={[styles.secondaryBtn, styles.coverBtn, locked && styles.disabled]}
            onPress={replaceCover}
            disabled={locked || busy === "cover"}
          >
            <Text style={styles.secondaryBtnText}>
              {busy === "cover" ? "Uploading…" : book.cover_url ? "Replace cover" : "Upload cover"}
            </Text>
          </Pressable>
        </View>
      </View>
      {book.status === "rejected" && book.review_note ? (
        <Text style={styles.rejectNote}>Rejected: {book.review_note}</Text>
      ) : null}
      {book.status === "pending_review" ? (
        <Text style={styles.pendingNote}>Waiting for admin review. Editing is locked.</Text>
      ) : null}

      <Text style={styles.section}>Details</Text>
      <TextInput
        style={[styles.input, locked && styles.disabledInput]}
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        placeholder="Title"
        placeholderTextColor={colors.inkSoft}
      />
      <TextInput
        style={[styles.input, styles.multiline, locked && styles.disabledInput]}
        value={description}
        onChangeText={setDescription}
        editable={!locked}
        placeholder="Description"
        placeholderTextColor={colors.inkSoft}
        multiline
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryWrap}>
        {categories.map((category) => {
          const active = categoryId === category.id;
          return (
            <Pressable
              key={category.id}
              disabled={locked}
              style={[styles.categoryChip, active && styles.categoryChipActive, locked && styles.disabled]}
              onPress={() => setCategoryId(category.id)}
            >
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                {category.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.pricingRow}>
        <Pressable
          style={[styles.choice, pricing === "free" && styles.choiceActive, locked && styles.disabled]}
          disabled={locked}
          onPress={() => setPricing("free")}
        >
          <Text style={[styles.choiceText, pricing === "free" && styles.choiceTextActive]}>Free</Text>
        </Pressable>
        <Pressable
          style={[styles.choice, pricing === "paid" && styles.choiceActive, locked && styles.disabled]}
          disabled={locked}
          onPress={() => setPricing("paid")}
        >
          <Text style={[styles.choiceText, pricing === "paid" && styles.choiceTextActive]}>Paid</Text>
        </Pressable>
      </View>
      {pricing === "paid" ? (
        <TextInput
          style={[styles.input, locked && styles.disabledInput]}
          value={price}
          onChangeText={setPrice}
          editable={!locked}
          keyboardType="decimal-pad"
          placeholder="4.99"
          placeholderTextColor={colors.inkSoft}
        />
      ) : null}
      <Pressable
        style={[styles.secondaryBtn, styles.saveBtn, locked && styles.disabled]}
        onPress={saveMeta}
        disabled={locked || busy === "save"}
      >
        <Text style={styles.secondaryBtnText}>{busy === "save" ? "Saving…" : "Save details"}</Text>
      </Pressable>

      <Text style={styles.section}>Character notes</Text>
      <Text style={styles.hint}>
        Upload a NHÂN VẬT.docx glossary so readers can long-press names for book notes
        without sending the whole chapter to AI.
      </Text>
      <Text style={styles.sub}>
        {glossaryCount == null
          ? "No glossary loaded yet."
          : `${glossaryCount} character note${glossaryCount === 1 ? "" : "s"} imported.`}
      </Text>
      <Pressable
        style={[styles.secondaryBtn, styles.saveBtn, locked && styles.disabled]}
        onPress={uploadGlossary}
        disabled={locked || busy === "glossary"}
      >
        <Text style={styles.secondaryBtnText}>
          {busy === "glossary"
            ? "Uploading…"
            : glossaryCount
              ? "Replace character notes"
              : "Upload character notes"}
        </Text>
      </Pressable>

      <Text style={styles.section}>Chapters</Text>
      <Text style={styles.hint}>
        Detects chapters and sections, then packs them into comfortable reading segments.
        Pick how long each part should feel.
      </Text>
      <View style={styles.pricingRow}>
        {SPLIT_LENGTH_OPTIONS.map((option) => {
          const active = splitLength === option.value;
          return (
            <Pressable
              key={option.value}
              disabled={locked}
              style={[styles.choice, active && styles.choiceActive, locked && styles.disabled]}
              onPress={() => setSplitLength(option.value)}
            >
              <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
                {option.label}
              </Text>
              <Text style={[styles.choiceHint, active && styles.choiceHintActive]}>
                {option.hint}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        style={[styles.primaryBtn, (!book.has_raw_text || locked) && styles.disabled]}
        onPress={split}
        disabled={!book.has_raw_text || locked || busy === "split"}
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
          style={[
            styles.publishBtn,
            (chapters.length === 0 || locked || !categoryId) && styles.disabled,
          ]}
          onPress={submit}
          disabled={chapters.length === 0 || locked || !categoryId || busy === "submit"}
        >
          <Text style={styles.publishBtnText}>
            {busy === "submit"
              ? "Submitting…"
              : book.status === "rejected"
                ? "Resubmit for review"
                : "Submit for review"}
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
  coverRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginTop: 4 },
  coverMeta: { flex: 1, gap: 8 },
  coverBtn: { alignSelf: "flex-start", marginTop: 4 },
  title: { fontSize: 24, fontWeight: "700", color: colors.ink },
  sub: { color: colors.inkSoft, marginTop: 2 },
  rejectNote: {
    marginTop: 8,
    color: colors.danger,
    backgroundColor: "rgba(155,28,28,0.08)",
    padding: 12,
    borderRadius: 10,
  },
  pendingNote: {
    marginTop: 8,
    color: colors.sageDeep,
    backgroundColor: "rgba(63,111,92,0.1)",
    padding: 12,
    borderRadius: 10,
  },
  section: {
    marginTop: 20,
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
  label: {
    marginTop: 8,
    fontSize: 12,
    letterSpacing: 1.2,
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
  disabledInput: { opacity: 0.6 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  categoryChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  categoryChipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  categoryText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  categoryTextActive: { color: "#fff" },
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
  choiceHint: { color: colors.inkSoft, fontSize: 11, marginTop: 2 },
  choiceHintActive: { color: "rgba(255,255,255,0.85)" },
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
