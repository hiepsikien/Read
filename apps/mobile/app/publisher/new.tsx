import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { ApiError } from "@read/api-client";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors } from "../../lib/theme";

type PickedFile = { uri: string; name: string; mimeType?: string };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function titleFromFilename(name: string) {
  return name
    .replace(/\.docx$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function NewBookScreen() {
  const router = useRouter();
  const { api } = useAuth();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  async function submit() {
    if (!file) {
      setError("Choose a DOCX manuscript.");
      return;
    }
    const resolvedTitle = titleFromFilename(file.name) || "Untitled manuscript";

    setLoading(true);
    setError("");

    const form = new FormData();
    form.append("title", resolvedTitle);
    form.append("description", "");
    form.append("pricing", "free");
    form.append("price", "0");
    form.append("category_id", "");
    form.append("file", {
      uri: file.uri,
      name: file.name.endsWith(".docx") ? file.name : `${file.name}.docx`,
      type: file.mimeType || DOCX_MIME,
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
        Choose your DOCX manuscript. Next you can set the cover, suggest category and description
        with AI, split chapters, and submit for review.
      </Text>

      <Text style={styles.label}>Manuscript (DOCX)</Text>
      <Pressable style={styles.fileBtn} onPress={pickFile}>
        <Text style={styles.fileBtnText}>{file ? file.name : "Choose DOCX file"}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.submitBtn, !file && styles.disabled]}
        onPress={submit}
        disabled={!file || loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>Upload &amp; continue</Text>
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
  fileBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
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
    paddingHorizontal: 18,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, marginTop: 8 },
});
