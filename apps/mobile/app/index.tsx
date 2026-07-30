import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { BookListItem, Category } from "@read/api-client";
import { BookTile } from "../components/BookTile";
import { CategoryChips } from "../components/CategoryChips";
import { SearchField } from "../components/SearchField";
import { useAuth } from "../lib/auth";
import { colors, radii, space } from "../lib/theme";

const H_PAD = 20;
const GAP = 14;

export default function LibraryScreen() {
  const router = useRouter();
  const { api, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [categorySlug, setCategorySlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [bookPayload, categoryPayload] = await Promise.all([
        api.listBooks(),
        api.listCategories(),
      ]);
      setBooks(bookPayload.books);
      setCategories(categoryPayload.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load library.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

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
      const haystack = `${book.title} ${book.publisher_name || ""} ${book.category?.label || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [books, categorySlug, query]);

  const tileWidth = useMemo(() => {
    const screen = Dimensions.get("window").width;
    return Math.floor((screen - H_PAD * 2 - GAP) / 2);
  }, []);

  if (authLoading || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
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
