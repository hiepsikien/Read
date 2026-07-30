import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { ApiError } from "@read/api-client";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors } from "../../lib/theme";

type PickedFile = { uri: string; name: string; mimeType?: string };

export default function NewBookScreen() {
  const router = useRouter();
  const { api } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    setError("");
  }

  async function submit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!file) {
      setError("Choose a PDF or DOCX file.");
      return;
    }

    setLoading(true);
    setError("");

    const form = new FormData();
    form.append("title", title.trim());
    form.append("description", description.trim());
    form.append("pricing", pricing);
    form.append("price", price);
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || guessMime(file.name),
    } as unknown as Blob);

    try {
      const data = await api.createBook(form);
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
        PDF or DOCX only. After upload you can auto-split chapters and publish.
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

      <Text style={styles.label}>Manuscript</Text>
      <Pressable style={styles.fileBtn} onPress={pickFile}>
        <Text style={styles.fileBtnText}>{file ? file.name : "Choose PDF or DOCX"}</Text>
      </Pressable>

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

function guessMime(name: string) {
  if (name.toLowerCase().endsWith(".pdf")) return "application/pdf";
  if (name.toLowerCase().endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
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
