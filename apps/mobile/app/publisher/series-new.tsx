import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { ApiError } from "@read/api-client";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { colors, radii, space } from "../../lib/theme";

export default function NewSeriesScreen() {
  const router = useRouter();
  const { api } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const payload = await api.createSeries({
        title: title.trim(),
        description: description.trim(),
      });
      router.replace(`/series/${payload.series.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create series.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: "New series" }} />
      <FormScroll contentContainerStyle={styles.content}>
        <Text style={styles.help}>
          Group episode books by season. Each uploaded book stays one purchasable episode.
        </Text>
        <Text style={styles.label}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          style={styles.input}
          placeholder="Series title"
          placeholderTextColor={colors.inkSoft}
        />
        <Text style={styles.label}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          style={[styles.input, styles.textarea]}
          multiline
          placeholder="Optional"
          placeholderTextColor={colors.inkSoft}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={[styles.primary, (!title.trim() || busy) && styles.disabled]}
          disabled={!title.trim() || busy}
          onPress={() => void create()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Create series</Text>
          )}
        </Pressable>
      </FormScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.lg, gap: space.sm },
  help: { color: colors.inkSoft, fontSize: 15, lineHeight: 22, marginBottom: space.sm },
  label: { color: colors.inkSoft, fontSize: 13, marginTop: space.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.ink,
    backgroundColor: "#fff",
  },
  textarea: { minHeight: 100, textAlignVertical: "top" },
  error: { color: colors.danger, marginTop: space.sm },
  primary: {
    marginTop: space.lg,
    backgroundColor: colors.sage,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
