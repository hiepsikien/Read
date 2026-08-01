import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type SeriesListItem, type SeriesSeason } from "@read/api-client";
import { BookCover } from "../../components/BookCover";
import { BookTile } from "../../components/BookTile";
import { useAuth } from "../../lib/auth";
import { colors, coverHeightForWidth, radii, space } from "../../lib/theme";

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api } = useAuth();
  const [series, setSeries] = useState<SeriesListItem | null>(null);
  const [seasons, setSeasons] = useState<SeriesSeason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    setLoading(true);
    try {
      const payload = await api.getSeries(id);
      setSeries(payload.series);
      setSeasons(payload.seasons);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load series.");
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: series?.title || "Series" }} />
      {loading ? (
        <ActivityIndicator color={colors.sage} style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : series ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <BookCover
              title={series.title}
              coverUrl={api.bookCoverUrl(series.cover_url, { cacheKey: series.updated_at })}
              width={120}
              height={coverHeightForWidth(120)}
              authenticated={false}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>Series</Text>
              <Text style={styles.title}>{series.title}</Text>
              {series.description ? <Text style={styles.body}>{series.description}</Text> : null}
              <Text style={styles.meta}>
                {series.episode_count} episode{series.episode_count === 1 ? "" : "s"}
              </Text>
            </View>
          </View>

          {seasons.map((season) => (
            <View key={season.season_number} style={styles.season}>
              <Text style={styles.seasonLabel}>Season {season.season_number}</Text>
              <View style={styles.grid}>
                {season.episodes.map((book) => (
                  <BookTile
                    key={book.id}
                    book={book}
                    width={140}
                    onPress={() => router.push(`/books/${book.id}`)}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {!loading && error ? (
        <Pressable onPress={() => void load()} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.lg, paddingBottom: 48, gap: space.md },
  hero: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  heroCopy: { flex: 1, gap: 6 },
  eyebrow: {
    color: colors.sage,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: { color: colors.ink, fontSize: 32, fontWeight: "700" },
  body: { color: colors.inkSoft, fontSize: 16, lineHeight: 24 },
  meta: { color: colors.inkSoft, fontSize: 14 },
  season: { marginTop: space.lg, gap: space.md },
  seasonLabel: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  error: { color: colors.danger, padding: space.lg },
  retry: {
    alignSelf: "center",
    marginTop: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.sage,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: "#fff", fontWeight: "600" },
});
