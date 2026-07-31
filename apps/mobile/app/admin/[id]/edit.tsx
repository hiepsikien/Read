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
import { ApiError, type BookDetail, type Category } from "@read/api-client";
import { BookCover } from "../../../components/BookCover";
import { FormScroll } from "../../../components/FormScroll";
import { useAuth } from "../../../lib/auth";
import { pickBookCoverImage } from "../../../lib/pick-cover";
import { colors, coverHeightForWidth, formatPrice } from "../../../lib/theme";

export default function AdminEditCatalogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, api, loading: authLoading } = useAuth();

  const [book, setBook] = useState<(BookDetail & { publisher_name?: string }) | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "cover">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const [data, categoryPayload] = await Promise.all([
        api.adminBook(id),
        api.listCategories(),
      ]);
      const next = data.book;
      if (next.status !== "published" || next.visibility !== "listed") {
        setError("Only listed published books can be edited here.");
        setBook(next);
        return;
      }
      setBook(next);
      setCategories(categoryPayload.categories);
      setTitle(next.title);
      setDescription(next.description || "");
      setPricing(next.price_cents > 0 ? "paid" : "free");
      setPrice(((next.price_cents || 499) / 100).toFixed(2));
      setCategoryId(next.category?.id || categoryPayload.categories[0]?.id || "");
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

  async function saveMeta() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!categoryId) {
      setError("Category is required.");
      return;
    }
    if (pricing === "paid") {
      const dollars = Number(price);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setError("Enter a valid paid price.");
        return;
      }
    }

    setBusy("save");
    setMessage("");
    setError("");
    try {
      await api.adminUpdateBook(id!, {
        title: trimmedTitle,
        description: description.trim(),
        pricing,
        price: Number(price),
        category_id: categoryId,
      });
      setMessage("Catalog details saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy("");
    }
  }

  async function replaceCover() {
    const picked = await pickBookCoverImage();
    if (!picked) return;
    setBusy("cover");
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", {
        uri: picked.uri,
        name: picked.name,
        type: picked.mimeType,
      } as unknown as Blob);
      await api.adminUploadBookCover(id!, form);
      setMessage("Cover updated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cover upload failed.");
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

  const canEdit = book.status === "published" && book.visibility === "listed";

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Edit catalog" }} />
      <View style={styles.coverRow}>
        <BookCover
          title={book.title}
          categorySlug={book.category?.slug}
          categoryLabel={book.category?.label}
          coverUrl={api.bookCoverUrl(book.cover_url, { cacheKey: book.updated_at })}
          width={110}
          height={coverHeightForWidth(110)}
        />
        <View style={styles.coverMeta}>
          <Text style={styles.title}>{book.title}</Text>
          <Text style={styles.sub}>
            {book.status} · {book.visibility || "listed"} · {formatPrice(book.price_cents)}
          </Text>
          <Pressable
            style={[styles.secondaryBtn, styles.coverBtn, (!canEdit || busy === "cover") && styles.disabled]}
            onPress={() => void replaceCover()}
            disabled={!canEdit || busy === "cover"}
          >
            <Text style={styles.secondaryBtnText}>
              {busy === "cover" ? "Uploading…" : book.cover_url ? "Replace cover" : "Upload cover"}
            </Text>
          </Pressable>
        </View>
      </View>

      {!canEdit ? (
        <Text style={styles.lockNote}>
          Catalog editing is only available for listed published books.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Admin-only. Changes apply immediately in the public Library.
        </Text>
      )}

      <Text style={styles.section}>Details</Text>
      <TextInput
        style={[styles.input, !canEdit && styles.disabledInput]}
        value={title}
        onChangeText={setTitle}
        editable={canEdit && busy === ""}
        placeholder="Title"
        placeholderTextColor={colors.inkSoft}
      />
      <TextInput
        style={[styles.input, styles.multiline, !canEdit && styles.disabledInput]}
        value={description}
        onChangeText={setDescription}
        editable={canEdit && busy === ""}
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
              disabled={!canEdit || busy !== ""}
              style={[
                styles.categoryChip,
                active && styles.categoryChipActive,
                !canEdit && styles.disabled,
              ]}
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
          style={[
            styles.choice,
            pricing === "free" && styles.choiceActive,
            !canEdit && styles.disabled,
          ]}
          disabled={!canEdit || busy !== ""}
          onPress={() => setPricing("free")}
        >
          <Text style={[styles.choiceText, pricing === "free" && styles.choiceTextActive]}>
            Free
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.choice,
            pricing === "paid" && styles.choiceActive,
            !canEdit && styles.disabled,
          ]}
          disabled={!canEdit || busy !== ""}
          onPress={() => setPricing("paid")}
        >
          <Text style={[styles.choiceText, pricing === "paid" && styles.choiceTextActive]}>
            Paid
          </Text>
        </Pressable>
      </View>
      {pricing === "paid" ? (
        <TextInput
          style={[styles.input, !canEdit && styles.disabledInput]}
          value={price}
          onChangeText={setPrice}
          editable={canEdit && busy === ""}
          keyboardType="decimal-pad"
          placeholder="4.99"
          placeholderTextColor={colors.inkSoft}
        />
      ) : null}

      <Pressable
        style={[styles.primaryBtn, (!canEdit || busy === "save") && styles.disabled]}
        onPress={() => void saveMeta()}
        disabled={!canEdit || busy === "save"}
      >
        <Text style={styles.primaryBtnText}>{busy === "save" ? "Saving…" : "Save catalog"}</Text>
      </Pressable>

      <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
        <Text style={styles.secondaryBtnText}>Back to review</Text>
      </Pressable>

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8, paddingBottom: 60 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mist,
  },
  coverRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginTop: 4 },
  coverMeta: { flex: 1, gap: 8 },
  coverBtn: { alignSelf: "flex-start", marginTop: 4 },
  title: { fontSize: 24, fontWeight: "700", color: colors.ink },
  sub: { color: colors.inkSoft, marginTop: 2 },
  hint: { color: colors.inkSoft, fontSize: 13, marginTop: 8, lineHeight: 18 },
  lockNote: {
    marginTop: 8,
    color: colors.danger,
    backgroundColor: "rgba(155,28,28,0.08)",
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
    paddingHorizontal: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  choiceActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  choiceText: { color: colors.ink, fontWeight: "600" },
  choiceTextActive: { color: "#fff" },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
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
    marginTop: 8,
  },
  secondaryBtnText: { color: colors.ink, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  success: { color: colors.sageDeep, marginTop: 12 },
  error: { color: colors.danger, marginTop: 12 },
});
