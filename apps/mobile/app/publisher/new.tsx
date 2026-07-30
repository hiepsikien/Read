import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ApiError, type Category } from "@read/api-client";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors } from "../../lib/theme";

type PickedFile = { uri: string; name: string; mimeType?: string };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function NewBookScreen() {
  const router = useRouter();
  const { api } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [cover, setCover] = useState<PickedFile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .listCategories()
      .then((data) => {
        if (cancelled) return;
        setCategories(data.categories);
        if (data.categories[0]) setCategoryId(data.categories[0].id);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load categories.");
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [DOCX_MIME],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset.name.toLowerCase().endsWith(".docx")) {
      setError("Only DOCX manuscripts are supported.");
      return;
    }
    setFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || DOCX_MIME });
    setError("");
  }

  async function pickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsEditing: true,
      aspect: [2, 3],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const name = asset.fileName || `cover.${(asset.mimeType || "image/jpeg").split("/")[1] || "jpg"}`;
    setCover({
      uri: asset.uri,
      name,
      mimeType: asset.mimeType || "image/jpeg",
    });
    setError("");
  }

  async function submit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!categoryId) {
      setError("Choose a category.");
      return;
    }
    if (!file) {
      setError("Choose a DOCX manuscript.");
      return;
    }

    setLoading(true);
    setError("");

    const form = new FormData();
    form.append("title", title.trim());
    form.append("description", description.trim());
    form.append("pricing", pricing);
    form.append("price", price);
    form.append("category_id", categoryId);
    form.append("file", {
      uri: file.uri,
      name: file.name.endsWith(".docx") ? file.name : `${file.name}.docx`,
      type: file.mimeType || DOCX_MIME,
    } as unknown as Blob);

    try {
      const data = await api.createBook(form);
      if (cover) {
        const coverForm = new FormData();
        coverForm.append("file", {
          uri: cover.uri,
          name: cover.name,
          type: cover.mimeType || "image/jpeg",
        } as unknown as Blob);
        await api.uploadBookCover(data.id, coverForm);
      }
      router.replace(`/publisher/${data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.title}>Upload a book</Text>
      <Text style={styles.sub}>
        Original manuscripts only — DOCX keeps your bold/italic styling. After upload you can
        auto-split chapters and submit for review.
      </Text>

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Book title"
        placeholderTextColor={colors.inkSoft}
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="A short blurb"
        placeholderTextColor={colors.inkSoft}
        multiline
        numberOfLines={4}
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryWrap}>
        {categories.map((category) => {
          const active = categoryId === category.id;
          return (
            <Pressable
              key={category.id}
              style={[styles.categoryChip, active && styles.categoryChipActive]}
              onPress={() => setCategoryId(category.id)}
            >
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                {category.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Pricing</Text>
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
        <>
          <Text style={styles.label}>Price (USD)</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="4.99"
            placeholderTextColor={colors.inkSoft}
          />
          <Text style={styles.hint}>Chapter 1 stays free as a preview inside Read.</Text>
        </>
      ) : null}

      <Text style={styles.label}>Manuscript (DOCX)</Text>
      <Pressable style={styles.fileBtn} onPress={pickFile}>
        <Text style={styles.fileBtnText}>{file ? file.name : "Choose DOCX file"}</Text>
      </Pressable>

      <Text style={styles.label}>Cover (optional)</Text>
      <Text style={styles.hint}>
        If the DOCX embeds a cover image we will try to use it. You can also upload one now.
      </Text>
      <Pressable style={styles.fileBtn} onPress={pickCover}>
        <Text style={styles.fileBtnText}>{cover ? cover.name : "Choose cover image"}</Text>
      </Pressable>
      {cover ? (
        <Image source={{ uri: cover.uri }} style={styles.coverPreview} resizeMode="cover" />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.submitBtn} onPress={submit} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>Upload &amp; extract</Text>
        )}
      </Pressable>
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink, marginTop: 4 },
  sub: { color: colors.inkSoft, lineHeight: 21, marginBottom: 8 },
  label: {
    marginTop: 10,
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
    marginTop: 4,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
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
  pricingRow: { flexDirection: "row", gap: 10, marginTop: 6 },
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
  hint: { color: colors.inkSoft, fontSize: 13, marginTop: 4 },
  fileBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  fileBtnText: { color: colors.sageDeep, fontWeight: "600" },
  coverPreview: {
    marginTop: 8,
    width: 120,
    height: 180,
    borderRadius: 10,
    backgroundColor: colors.sand,
  },
  submitBtn: {
    marginTop: 20,
    backgroundColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontWeight: "600" },
  error: { color: colors.danger, marginTop: 8 },
});
