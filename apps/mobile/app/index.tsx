import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { BookListItem, Category, ReadingShelfItem, SeriesContinueItem, SeriesListItem } from "@read/api-client";
import { BookTile } from "../components/BookTile";
import { BookCover } from "../components/BookCover";
import { CategoryChips } from "../components/CategoryChips";
import { SearchField } from "../components/SearchField";
import { useAuth } from "../lib/auth";
import { formatProgressLabel } from "../lib/reading-progress";
import { colors, coverHeightForWidth, radii, space } from "../lib/theme";

const H_PAD = 20;
const GAP = 14;
const CONTINUE_TILE = Math.min(120, Math.round(Dimensions.get("window").width * 0.32));

export default function LibraryScreen() {
  const router = useRouter();
  const { api, user, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [continueItems, setContinueItems] = useState<ReadingShelfItem[]>([]);
  const [seriesContinue, setSeriesContinue] = useState<SeriesContinueItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [categorySlug, setCategorySlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [bookPayload, categoryPayload, readingPayload, seriesPayload] = await Promise.all([
        api.listBooks(),
        api.listCategories(),
        user
          ? api.listReading().catch(() => ({
              items: [] as ReadingShelfItem[],
              series_continue: [] as SeriesContinueItem[],
            }))
          : Promise.resolve({
              items: [] as ReadingShelfItem[],
              series_continue: [] as SeriesContinueItem[],
            }),
        api.listSeries().catch(() => ({ series: [] as SeriesListItem[] })),
      ]);
      setBooks(bookPayload.books);
      setCategories(categoryPayload.categories);
      setSeriesList(seriesPayload.series);
      setContinueItems(
        readingPayload.items.filter(
          (item, index, all) =>
            all.findIndex((other) => other.book.id === item.book.id) === index
        )
      );
      setSeriesContinue(readingPayload.series_continue || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load library.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return books.filter((book) => {
      if (categorySlug && book.category?.slug !== categorySlug) return false;
      if (!needle) return true;
      const haystack = `${book.title} ${book.author_name || ""} ${book.publisher_name || ""} ${book.publisher_handle || ""} ${book.category?.label || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [books, categorySlug, query]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const book of books) {
      const slug = book.category?.slug;
      if (!slug) continue;
      counts[slug] = (counts[slug] || 0) + 1;
    }
    return counts;
  }, [books]);

  useEffect(() => {
    if (categorySlug && (categoryCounts[categorySlug] || 0) === 0) {
      setCategorySlug(null);
    }
  }, [categorySlug, categoryCounts]);

  const tileWidth = useMemo(() => {
    const screen = Dimensions.get("window").width;
    return Math.floor((screen - H_PAD * 2 - GAP) / 2);
  }, []);

  // Library is public — don't block the whole screen on auth bootstrap.
  // Auth still hydrates in the background for Settings / Continue reading.
  if (loading && books.length === 0 && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
        {authLoading ? (
          <Text style={{ marginTop: 12, color: colors.inkSoft, fontSize: 13 }}>
            Starting…
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.sage}
        />
      }
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>In-app reading</Text>
        <Text style={styles.sub}>
          Browse published titles. Free books open instantly; paid books unlock after purchase.
        </Text>
      </View>

      {continueItems.length > 0 ? (
        <View style={styles.continueBlock}>
          <Text style={styles.section}>Continue reading</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.continueRow}
          >
            {continueItems.map((item) => (
              <View key={item.book.id} style={{ width: CONTINUE_TILE, gap: 6 }}>
                <BookTile
                  book={item.book}
                  width={CONTINUE_TILE}
                  onPress={() =>
                    router.push(`/read/${item.book.id}/${item.progress.chapter_id}`)
                  }
                  onPressSeries={
                    item.book.series
                      ? () => router.push(`/series/${item.book.series!.id}`)
                      : undefined
                  }
                />
                <Text style={styles.continueMeta} numberOfLines={1}>
                  {formatProgressLabel(
                    item.progress.chapter_position,
                    item.progress.chapter_count,
                    item.progress.scroll_fraction
                  )}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {seriesContinue.length > 0 ? (
        <View style={styles.continueBlock}>
          <Text style={styles.section}>Continue series</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.continueRow}
          >
            {seriesContinue.map((item) => (
              <View key={item.book.id} style={{ width: CONTINUE_TILE, gap: 6 }}>
                <BookTile
                  book={item.book}
                  width={CONTINUE_TILE}
                  onPress={() => router.push(`/books/${item.book.id}`)}
                  onPressSeries={
                    item.series ? () => router.push(`/series/${item.series!.id}`) : undefined
                  }
                />
                <Text style={styles.continueMeta} numberOfLines={1}>
                  {item.owned ? "Next episode" : "Unlock next"}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {seriesList.length > 0 ? (
        <View style={styles.continueBlock}>
          <Text style={styles.section}>Series</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.continueRow}
          >
            {seriesList.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.seriesChip, { width: CONTINUE_TILE }]}
                onPress={() => router.push(`/series/${item.id}`)}
              >
                <BookCover
                  title={item.title}
                  coverUrl={api.bookCoverUrl(item.cover_url, { cacheKey: item.updated_at })}
                  width={CONTINUE_TILE}
                  height={coverHeightForWidth(CONTINUE_TILE)}
                  authenticated={false}
                  showTitle={false}
                />
                <Text style={styles.seriesChipTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.seriesChipMeta}>
                  {item.episode_count} ep{item.episode_count === 1 ? "" : "s"}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <SearchField value={query} onChangeText={setQuery} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
      >
        <CategoryChips
          categories={categories}
          selected={categorySlug}
          onSelect={setCategorySlug}
          countsBySlug={categoryCounts}
          allCount={books.length}
          hideEmpty
        />
      </ScrollView>

      <View style={styles.sectionRow}>
        <Text style={styles.section}>Library</Text>
        <Text style={styles.count}>
          {filtered.length} title{filtered.length === 1 ? "" : "s"}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No titles match</Text>
          <Text style={styles.emptyBody}>
            {books.length === 0
              ? "No published books yet. Check back soon."
              : "Try another category or clear the search."}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {filtered.map((book) => (
            <BookTile
              key={book.id}
              book={book}
              width={tileWidth}
              onPress={() => router.push(`/books/${book.id}`)}
              onPressSeries={
                book.series ? () => router.push(`/series/${book.series!.id}`) : undefined
              }
              onPressPublisher={
                !book.series && book.publisher_handle
                  ? () => router.push(`/@${book.publisher_handle}`)
                  : undefined
              }
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: H_PAD,
    paddingTop: space.md,
    paddingBottom: 56,
    gap: space.lg,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mist,
  },
  hero: { gap: space.sm },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.sage,
    fontWeight: "700",
  },
  sub: { color: colors.inkSoft, lineHeight: 21, maxWidth: 340 },
  continueBlock: { gap: space.md },
  continueRow: { gap: space.md, paddingRight: space.lg },
  continueMeta: { color: colors.sageDeep, fontSize: 11, fontWeight: "600" },
  seriesChip: {
    gap: 8,
  },
  seriesChipTitle: { color: colors.ink, fontWeight: "700", fontSize: 14, lineHeight: 18 },
  seriesChipMeta: { color: colors.inkSoft, fontSize: 12 },
  chipScroll: { paddingRight: space.lg },
  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  section: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "700",
  },
  count: { color: colors.inkSoft, fontSize: 13 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
  },
  empty: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    padding: space.xl,
    gap: space.sm,
  },
  emptyTitle: { color: colors.ink, fontWeight: "700", fontSize: 16 },
  emptyBody: { color: colors.inkSoft, lineHeight: 20 },
  error: { color: colors.danger },
});
