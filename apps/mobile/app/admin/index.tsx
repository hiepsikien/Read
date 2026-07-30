import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  ApiError,
  type BookListItem,
  type ContentReport,
  type ReportStatus,
} from "@read/api-client";
import { SearchField } from "../../components/SearchField";
import { useAuth } from "../../lib/auth";
import { colors, formatPrice, radii, space } from "../../lib/theme";

type AdminTab = "queue" | "library" | "reports";
type LibraryFilter = "listed" | "featured" | "rejected" | "hidden" | "removed";

type AdminCounts = {
  pending_count: number;
  library_count: number;
  report_count: number;
  library_counts: Record<LibraryFilter, number>;
  report_counts: Record<ReportStatus, number>;
};

const EMPTY_COUNTS: AdminCounts = {
  pending_count: 0,
  library_count: 0,
  report_count: 0,
  library_counts: {
    listed: 0,
    featured: 0,
    rejected: 0,
    hidden: 0,
    removed: 0,
  },
  report_counts: {
    open: 0,
    resolved: 0,
    dismissed: 0,
  },
};

export default function AdminQueueScreen() {
  const router = useRouter();
  const { user, api, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [counts, setCounts] = useState<AdminCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<AdminTab>("queue");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("listed");
  const [reportStatus, setReportStatus] = useState<ReportStatus>("open");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const summaryPromise = api.adminSummary().catch(() => null);
      if (tab === "queue") {
        const [data, summary] = await Promise.all([api.adminQueue(), summaryPromise]);
        setBooks(data.books);
        if (summary) setCounts(summary);
      } else if (tab === "library") {
        const options =
          libraryFilter === "listed"
            ? { status: "published" as const, visibility: "listed" as const, q: query }
            : libraryFilter === "featured"
              ? {
                  status: "published" as const,
                  visibility: "listed" as const,
                  featured: true,
                  q: query,
                }
              : libraryFilter === "hidden" || libraryFilter === "removed"
                ? {
                    status: "published" as const,
                    visibility: libraryFilter,
                    q: query,
                  }
                : { status: libraryFilter, q: query };
        const [data, summary] = await Promise.all([
          api.adminListBooks(options),
          summaryPromise,
        ]);
        setBooks(data.books);
        if (summary) setCounts(summary);
      } else {
        const [data, summary] = await Promise.all([
          api.adminReports(reportStatus),
          summaryPromise,
        ]);
        setReports(data.reports);
        if (summary) setCounts(summary);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load admin data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, libraryFilter, query, reportStatus, tab]);

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

  if (authLoading || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  const tabCounts: Record<AdminTab, number> = {
    queue: counts.pending_count,
    library: counts.library_count,
    reports: counts.report_count,
  };

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
      <Stack.Screen options={{ title: "Admin" }} />
      <Text style={styles.eyebrow}>Moderation</Text>
      <Text style={styles.title}>Admin center</Text>

      <View style={styles.tabs}>
        {(["queue", "library", "reports"] as AdminTab[]).map((item) => (
          <Pressable
            key={item}
            style={[styles.tab, tab === item && styles.tabActive]}
            onPress={() => {
              setLoading(true);
              setTab(item);
            }}
          >
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>
              {item[0].toUpperCase() + item.slice(1)} ({tabCounts[item]})
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {tab === "library" ? (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search title or publisher" />
          <View style={styles.filters}>
            {(["listed", "featured", "rejected", "hidden", "removed"] as LibraryFilter[]).map(
              (item) => (
                <FilterChip
                  key={item}
                  label={`${item} (${counts.library_counts[item]})`}
                  active={libraryFilter === item}
                  onPress={() => {
                    setLoading(true);
                    setLibraryFilter(item);
                  }}
                />
              )
            )}
          </View>
        </>
      ) : null}

      {tab === "reports" ? (
        <View style={styles.filters}>
          {(["open", "resolved", "dismissed"] as ReportStatus[]).map((item) => (
            <FilterChip
              key={item}
              label={`${item} (${counts.report_counts[item]})`}
              active={reportStatus === item}
              onPress={() => {
                setLoading(true);
                setReportStatus(item);
              }}
            />
          ))}
        </View>
      ) : null}

      {tab === "reports" ? (
        <View style={styles.reportList}>
          {reports.length === 0 ? (
            <Text style={styles.meta}>No {reportStatus} reports.</Text>
          ) : (
            reports.map((report) => (
              <View key={report.id} style={styles.reportCard}>
                <Pressable onPress={() => router.push(`/admin/${report.book_id}`)}>
                  <Text style={styles.rowTitle}>{report.book_title}</Text>
                  <Text style={styles.badge}>{report.reason}</Text>
                  <Text style={styles.rowMeta}>
                    {report.reporter_name} · {new Date(report.created_at).toLocaleString()}
                  </Text>
                  {report.details ? <Text style={styles.reportDetails}>{report.details}</Text> : null}
                </Pressable>
                {report.status === "open" ? (
                  <View style={styles.reportActions}>
                    <SmallAction
                      label="Dismiss"
                      onPress={() => confirmReportAction(report, "dismiss")}
                    />
                    <SmallAction
                      label="Resolve"
                      onPress={() => confirmReportAction(report, "resolve")}
                    />
                    <SmallAction
                      label="Hide book"
                      danger
                      onPress={() => confirmReportAction(report, "hide")}
                    />
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : (
        <View style={styles.list}>
          {books.length === 0 ? (
            <Text style={styles.meta}>
              {tab === "queue" ? "No books waiting for review." : "No books in this view."}
            </Text>
          ) : (
            books.map((book) => (
              <Pressable
                key={book.id}
                style={styles.row}
                onPress={() => router.push(`/admin/${book.id}`)}
              >
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle}>{book.title}</Text>
                  {book.featured ? <Text style={styles.featured}>Featured</Text> : null}
                </View>
                <Text style={styles.rowMeta}>
                  {book.category?.label ? `${book.category.label} · ` : ""}
                  {book.publisher_name} · {formatPrice(book.price_cents)} · {book.chapter_count} chapters
                </Text>
                <Text style={styles.rowMeta}>
                  {book.status}
                  {book.visibility ? ` · ${book.visibility}` : ""}
                  {book.report_count ? ` · ${book.report_count} open report(s)` : ""}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );

  function confirmReportAction(
    report: ContentReport,
    action: "resolve" | "dismiss" | "hide"
  ) {
    Alert.alert(
      action === "hide" ? "Hide reported book?" : `${action[0].toUpperCase() + action.slice(1)} report?`,
      action === "hide"
        ? "The book will disappear from the public Library and the report will be resolved."
        : report.book_title,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action === "hide" ? "Hide book" : "Confirm",
          style: action === "hide" ? "destructive" : "default",
          onPress: () => {
            void api
              .adminResolveReport(report.id, action)
              .then(load)
              .catch((err) =>
                setError(err instanceof ApiError ? err.message : "Could not update report.")
              );
          },
        },
      ]
    );
  }
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.filter, active && styles.filterActive]} onPress={onPress}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SmallAction({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={[styles.smallAction, danger && styles.smallActionDanger]} onPress={onPress}>
      <Text style={[styles.smallActionText, danger && styles.smallActionDangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10, paddingBottom: 48 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.sage,
    fontWeight: "600",
  },
  title: { fontSize: 32, fontWeight: "700", color: colors.ink, marginTop: 4 },
  tabs: { flexDirection: "row", gap: 8, marginVertical: 6 },
  tab: {
    flex: 1,
    borderRadius: radii.sm,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  tabActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  tabText: { color: colors.ink, fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: colors.white },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: colors.card,
  },
  filterActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterText: { color: colors.inkSoft, textTransform: "capitalize", fontSize: 12 },
  filterTextActive: { color: colors.white, fontWeight: "600" },
  list: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 4,
  },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { fontSize: 18, fontWeight: "600", color: colors.ink },
  rowMeta: { fontSize: 13, color: colors.inkSoft },
  featured: { color: colors.sageDeep, fontSize: 11, fontWeight: "700" },
  badge: {
    alignSelf: "flex-start",
    color: colors.sageDeep,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginVertical: 4,
  },
  reportList: { gap: space.md },
  reportCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
  },
  reportDetails: { color: colors.ink, lineHeight: 19, marginTop: 7 },
  reportActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallAction: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  smallActionDanger: { borderColor: colors.danger },
  smallActionText: { color: colors.ink, fontWeight: "600", fontSize: 12 },
  smallActionDangerText: { color: colors.danger },
  meta: { color: colors.inkSoft, padding: 16 },
  error: { color: colors.danger, marginTop: 8 },
});
