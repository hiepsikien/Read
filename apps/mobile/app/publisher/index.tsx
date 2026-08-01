import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { ApiError, type BookListItem, type SeriesListItem } from "@read/api-client";
import { BookCover } from "../../components/BookCover";
import { useAuth } from "../../lib/auth";
import {
  bookStatusLabel,
  formatRelativeTime,
  publisherBookMetaLine,
  shouldShowStoreBadge,
  visibilityLabel,
} from "../../lib/book-labels";
import { colors, coverHeightForWidth, formatPrice, radii } from "../../lib/theme";

type ListFilter = "all" | "in_progress" | "on_shelf" | "needs_attention";

const FILTERS: Array<{ value: ListFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "In progress" },
  { value: "on_shelf", label: "On shelf" },
  { value: "needs_attention", label: "Needs attention" },
];

const COVER_W = 52;

function matchesFilter(book: BookListItem, filter: ListFilter) {
  if (filter === "all") return true;
  if (filter === "in_progress") {
    return book.status === "draft" || book.status === "pending_review" || book.status === "rejected";
  }
  if (filter === "on_shelf") {
    return book.status === "published" && (book.visibility ?? "listed") === "listed";
  }
  // needs_attention
  return book.status === "rejected" || book.visibility === "hidden";
}

function workflowBadgeTone(status: string): "neutral" | "sage" | "warn" | "danger" {
  if (status === "published") return "sage";
  if (status === "pending_review") return "neutral";
  if (status === "rejected") return "danger";
  return "neutral";
}

function storeBadgeTone(visibility: string | null | undefined): "sage" | "warn" | "muted" {
  if (visibility === "hidden") return "warn";
  if (visibility === "removed") return "muted";
  return "sage";
}

export default function PublisherHome() {
  const router = useRouter();
  const { user, api, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");

  const load = useCallback(async () => {
    setError("");
    try {
      const [data, seriesPayload] = await Promise.all([
        api.listBooks({ mine: true }),
        api.listSeries({ mine: true }),
      ]);
      setBooks(data.books);
      setSeriesList(seriesPayload.series);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load books.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.role !== "publisher" && user.role !== "admin") {
        router.replace("/");
        return;
      }
      void load();
    }, [authLoading, user, router, load])
  );

  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of books) {
      const key = book.title.trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count >= 2).map(([title]) => title)
    );
  }, [books]);

  const { mainBooks, removedBooks, filterCounts, mainTotal } = useMemo(() => {
    const main: BookListItem[] = [];
    const removed: BookListItem[] = [];
    for (const book of books) {
      if (book.visibility === "removed") removed.push(book);
      else main.push(book);
    }
    const counts: Record<ListFilter, number> = {
      all: main.length,
      in_progress: main.filter((book) => matchesFilter(book, "in_progress")).length,
      on_shelf: main.filter((book) => matchesFilter(book, "on_shelf")).length,
      needs_attention: main.filter((book) => matchesFilter(book, "needs_attention")).length,
    };
    return {
      mainBooks: main.filter((book) => matchesFilter(book, filter)),
      removedBooks: removed,
      filterCounts: counts,
      mainTotal: main.length,
    };
  }, [books, filter]);

  if (authLoading || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  const isEmptyLibrary = books.length === 0;

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
      <Stack.Screen
        options={{
          title: "Publisher",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/publisher/new")}
              hitSlop={8}
              style={styles.headerUpload}
            >
              <Text style={styles.headerUploadText}>Upload</Text>
            </Pressable>
          ),
        }}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.seriesBlock}>
        <View style={styles.seriesHeader}>
          <Text style={styles.title}>Series · {seriesList.length}</Text>
          <Pressable onPress={() => router.push("/publisher/series-new")} hitSlop={8}>
            <Text style={styles.headerUploadText}>New</Text>
          </Pressable>
        </View>
        {seriesList.length === 0 ? (
          <Text style={styles.meta}>Create a series, then attach episodes from each book.</Text>
        ) : (
          seriesList.map((item) => (
            <Pressable
              key={item.id}
              style={styles.seriesRow}
              onPress={() => router.push(`/publisher/series/${item.id}`)}
            >
              <BookCover
                title={item.title}
                coverUrl={api.bookCoverUrl(item.cover_url, { cacheKey: item.updated_at })}
                width={44}
                height={coverHeightForWidth(44)}
                showTitle={false}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.seriesRowTitle}>{item.title}</Text>
                <Text style={styles.meta}>
                  {item.episode_count} episode{item.episode_count === 1 ? "" : "s"}
                  {item.visibility === "hidden" ? " · Hidden" : ""}
                </Text>
              </View>
              <Text style={styles.headerUploadText}>Manage</Text>
            </Pressable>
          ))
        )}
      </View>

      <View style={styles.toolbar}>
        <Text style={styles.title}>Your books · {mainTotal}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map((item) => {
          const active = filter === item.value;
          return (
            <Pressable
              key={item.value}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(item.value)}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {item.label} {filterCounts[item.value]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.list}>
        {isEmptyLibrary ? (
          <View style={styles.empty}>
            <Text style={styles.emptyCopy}>Upload a DOCX to start.</Text>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => router.push("/publisher/new")}
            >
              <Text style={styles.primaryBtnText}>Upload book</Text>
            </Pressable>
          </View>
        ) : mainBooks.length === 0 ? (
          <Text style={styles.meta}>No books in this view.</Text>
        ) : (
          mainBooks.map((book) => (
            <BookRow
              key={book.id}
              book={book}
              api={api}
              showUploaded={duplicateTitles.has(book.title.trim().toLowerCase())}
              onPress={() => router.push(`/publisher/${book.id}`)}
            />
          ))
        )}
      </View>

      {removedBooks.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Removed from Library</Text>
          <Text style={styles.sectionHint}>
            These books were taken off the public shelf. You can still open them for details.
          </Text>
          <View style={[styles.list, styles.removedList]}>
            {removedBooks.map((book) => (
              <BookRow
                key={book.id}
                book={book}
                api={api}
                muted
                showUploaded={duplicateTitles.has(book.title.trim().toLowerCase())}
                onPress={() => router.push(`/publisher/${book.id}`)}
              />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function BookRow({
  book,
  api,
  onPress,
  muted = false,
  showUploaded = false,
}: {
  book: BookListItem;
  api: ReturnType<typeof useAuth>["api"];
  onPress: () => void;
  muted?: boolean;
  showUploaded?: boolean;
}) {
  const showStore = shouldShowStoreBadge(book);
  const uploaded = showUploaded ? formatRelativeTime(book.created_at) : null;

  return (
    <Pressable
      style={[styles.row, muted && styles.rowMuted]}
      onPress={onPress}
    >
      <BookCover
        title={book.title}
        categorySlug={book.category?.slug}
        categoryLabel={book.category?.label}
        coverUrl={
          book.cover_url
            ? api.bookCoverUrl(book.cover_url, { cacheKey: book.updated_at })
            : null
        }
        width={COVER_W}
        height={coverHeightForWidth(COVER_W)}
        showTitle={false}
      />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, muted && styles.textMuted]} numberOfLines={2}>
          {book.title}
        </Text>
        <View style={styles.badgeRow}>
          <StatusBadge
            label={bookStatusLabel(book.status)}
            tone={workflowBadgeTone(book.status)}
          />
          {showStore ? (
            <StatusBadge
              label={visibilityLabel(book.visibility)}
              tone={storeBadgeTone(book.visibility)}
            />
          ) : null}
        </View>
        <Text style={[styles.rowMeta, muted && styles.textMuted]} numberOfLines={2}>
          {[publisherBookMetaLine(book), formatPrice(book.price_cents)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {uploaded ? (
          <Text style={[styles.rowMeta, muted && styles.textMuted]}>Uploaded {uploaded}</Text>
        ) : null}
        {book.visibility_note &&
        (book.visibility === "hidden" || book.visibility === "removed") ? (
          <Text style={styles.note} numberOfLines={2}>
            {book.visibility_note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "sage" | "warn" | "danger" | "muted";
}) {
  return (
    <View style={[styles.badge, badgeToneStyles[tone]]}>
      <Text style={[styles.badgeText, badgeTextToneStyles[tone]]}>{label}</Text>
    </View>
  );
}

const badgeToneStyles = StyleSheet.create({
  neutral: { backgroundColor: "rgba(20,34,28,0.06)" },
  sage: { backgroundColor: "rgba(63,111,92,0.14)" },
  warn: { backgroundColor: "rgba(154,106,0,0.14)" },
  danger: { backgroundColor: "rgba(155,28,28,0.10)" },
  muted: { backgroundColor: "rgba(20,34,28,0.05)" },
});

const badgeTextToneStyles = StyleSheet.create({
  neutral: { color: colors.inkSoft },
  sage: { color: colors.sageDeep },
  warn: { color: "#7a5500" },
  danger: { color: colors.danger },
  muted: { color: colors.inkSoft },
});

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 12, gap: 8, paddingBottom: 48 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  headerUpload: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 4,
  },
  headerUploadText: { color: colors.sage, fontWeight: "700", fontSize: 16 },
  toolbar: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  seriesBlock: { gap: 10, marginBottom: 4 },
  seriesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  seriesTitle: { fontSize: 14, fontWeight: "700", color: colors.inkSoft, letterSpacing: 0.6 },
  seriesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: 12,
    backgroundColor: colors.card,
  },
  seriesRowTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  primaryBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.sage,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  filters: { gap: 8, paddingVertical: 2 },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  filterChipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  filterText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  filterTextActive: { color: "#fff" },
  list: {
    marginTop: 4,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  empty: { padding: 20, gap: 12 },
  emptyCopy: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
  removedList: { opacity: 0.92 },
  sectionTitle: {
    marginTop: 20,
    fontSize: 16,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  sectionHint: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    alignItems: "flex-start",
  },
  rowMuted: { backgroundColor: "rgba(20,34,28,0.03)" },
  rowBody: { flex: 1, gap: 6, minWidth: 0 },
  rowTitle: { fontSize: 17, fontWeight: "600", color: colors.ink },
  rowMeta: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  textMuted: { color: colors.inkSoft, opacity: 0.85 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  note: { fontSize: 12, color: colors.danger, lineHeight: 16 },
  meta: { color: colors.inkSoft, padding: 16 },
  error: { color: colors.danger, marginTop: 4 },
});
