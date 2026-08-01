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
import * as DocumentPicker from "expo-document-picker";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ApiError,
  formatEpisodeCode,
  type SeriesListItem,
  type SeriesSeason,
} from "@read/api-client";
import { FormScroll } from "../../../components/FormScroll";
import { BookCover } from "../../../components/BookCover";
import { useAuth } from "../../../lib/auth";
import { colors, coverHeightForWidth, formatPrice, radii, space } from "../../../lib/theme";

export default function ManageSeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api, user } = useAuth();
  const [series, setSeries] = useState<SeriesListItem | null>(null);
  const [seasons, setSeasons] = useState<SeriesSeason[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const payload = await api.getSeries(id);
      setSeries(payload.series);
      setSeasons(payload.seasons);
      setTitle(payload.series.title);
      setDescription(payload.series.description || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load series.");
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function saveMeta() {
    if (!id) return;
    setBusy("save");
    setMessage("");
    setError("");
    try {
      const payload = await api.updateSeries(id, {
        title: title.trim(),
        description: description.trim(),
      });
      setSeries(payload.series);
      setMessage("Series details saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy("");
    }
  }

  async function uploadCover() {
    if (!id) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy("cover");
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", {
        uri: asset.uri,
        name: asset.name || "cover.jpg",
        type: asset.mimeType || "image/jpeg",
      } as unknown as Blob);
      await api.uploadSeriesCover(id, form);
      setMessage("Cover updated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cover upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function setVisibility(visibility: "listed" | "hidden") {
    if (!id) return;
    setBusy("visibility");
    setMessage("");
    setError("");
    try {
      const payload = await api.updateSeries(id, { visibility });
      setSeries(payload.series);
      setMessage(visibility === "hidden" ? "Series hidden from catalog." : "Series shown on catalog.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Visibility update failed.");
    } finally {
      setBusy("");
    }
  }

  function confirmDelete() {
    if (!id || !series) return;
    const count = series.episode_count;
    Alert.alert(
      "Delete series?",
      count
        ? `${count} episode${count === 1 ? "" : "s"} will become unassigned. The books themselves stay.`
        : "This permanently deletes the series.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void deleteSeries(),
        },
      ]
    );
  }

  async function deleteSeries() {
    if (!id) return;
    setBusy("delete");
    setMessage("");
    setError("");
    try {
      await api.deleteSeries(id);
      router.replace(isAdmin ? "/admin" : "/publisher");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
      setBusy("");
    }
  }

  const episodeTotal = seasons.reduce((sum, season) => sum + season.episodes.length, 0);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: series?.title || "Series" }} />
      <FormScroll contentContainerStyle={styles.content}>
        {error && !series ? <Text style={styles.error}>{error}</Text> : null}
        {!series && !error ? <ActivityIndicator color={colors.sage} /> : null}
        {series ? (
          <>
            <Text style={styles.meta}>
              {episodeTotal} episode{episodeTotal === 1 ? "" : "s"}
              {series.visibility === "hidden" ? " · Hidden from catalog" : ""}
            </Text>
            <View style={styles.coverPreview}>
              <BookCover
                title={series.title}
                coverUrl={api.bookCoverUrl(series.cover_url, { cacheKey: series.updated_at })}
                width={96}
                height={coverHeightForWidth(96)}
                showTitle={false}
              />
              <Text style={styles.coverHint}>
                {series.cover_url
                  ? "Shown on the public series page and Library strip."
                  : "No cover yet — upload below."}
              </Text>
            </View>
            <Text style={styles.label}>Title</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} />
            <Text style={styles.label}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              style={[styles.input, styles.textarea]}
              multiline
            />
            <Pressable
              style={styles.secondary}
              onPress={() => void saveMeta()}
              disabled={busy === "save"}
            >
              <Text style={styles.secondaryText}>
                {busy === "save" ? "Saving…" : "Save details"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.secondary}
              onPress={() => void uploadCover()}
              disabled={busy === "cover"}
            >
              <Text style={styles.secondaryText}>
                {busy === "cover" ? "Uploading…" : "Upload cover"}
              </Text>
            </Pressable>
            <Pressable onPress={() => router.push(`/series/${series.id}`)}>
              <Text style={styles.link}>Open public page</Text>
            </Pressable>

            {isAdmin ? (
              <Pressable
                style={styles.secondary}
                onPress={() =>
                  void setVisibility(series.visibility === "hidden" ? "listed" : "hidden")
                }
                disabled={busy === "visibility"}
              >
                <Text style={styles.secondaryText}>
                  {busy === "visibility"
                    ? "Updating…"
                    : series.visibility === "hidden"
                      ? "Show on catalog"
                      : "Hide from catalog"}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              style={[styles.secondary, styles.dangerBtn]}
              onPress={confirmDelete}
              disabled={busy === "delete"}
            >
              <Text style={styles.dangerText}>
                {busy === "delete" ? "Deleting…" : "Delete series"}
              </Text>
            </Pressable>

            {message ? <Text style={styles.message}>{message}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Text style={styles.section}>Episodes</Text>
            {seasons.length === 0 ? (
              <Text style={styles.meta}>No episodes attached yet.</Text>
            ) : (
              seasons.map((season) => (
                <View key={season.season_number} style={styles.season}>
                  <Text style={styles.seasonLabel}>Season {season.season_number}</Text>
                  {season.episodes.map((ep) => {
                    const code = formatEpisodeCode(ep.season_number, ep.episode_number);
                    return (
                      <Pressable
                        key={ep.id}
                        style={styles.episodeRow}
                        onPress={() => router.push(`/publisher/${ep.id}`)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.episodeTitle}>
                            {code ? `${code} · ` : ""}
                            {ep.title}
                          </Text>
                          <Text style={styles.meta}>
                            {ep.status} · {formatPrice(ep.price_cents)}
                          </Text>
                        </View>
                        <Text style={styles.link}>Manage</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </>
        ) : null}
      </FormScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.lg, gap: space.sm, paddingBottom: 48 },
  label: { color: colors.inkSoft, fontSize: 13, marginTop: space.sm },
  coverPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: space.sm,
  },
  coverHint: { flex: 1, color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
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
  secondary: {
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  secondaryText: { color: colors.ink, fontWeight: "600" },
  dangerBtn: {
    borderColor: "rgba(155,28,28,0.35)",
    backgroundColor: "rgba(155,28,28,0.06)",
  },
  dangerText: { color: colors.danger, fontWeight: "700" },
  link: { color: colors.sage, fontWeight: "600", marginTop: 8 },
  message: { color: colors.sageDeep, marginTop: 8 },
  error: { color: colors.danger, marginTop: 8 },
  meta: { color: colors.inkSoft, fontSize: 13 },
  section: {
    marginTop: space.xl,
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  season: { marginTop: space.md, gap: space.sm },
  seasonLabel: { color: colors.inkSoft, fontWeight: "700", fontSize: 12 },
  episodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: 12,
    backgroundColor: colors.card,
  },
  episodeTitle: { color: colors.ink, fontWeight: "700", fontSize: 15 },
});
