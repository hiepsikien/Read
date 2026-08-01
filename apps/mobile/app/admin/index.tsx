import { useCallback, useEffect, useState } from "react";
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
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ApiError,
  formatEpisodeCode,
  type BookListItem,
  type ContentReport,
  type ReportStatus,
  type SeriesListItem,
  type UserRole,
} from "@read/api-client";
import { AdminNarrationPanel } from "../../components/AdminNarrationPanel";
import { BookCover } from "../../components/BookCover";
import { SearchField } from "../../components/SearchField";
import { useAuth } from "../../lib/auth";
import { bookActivityLine } from "../../lib/book-labels";
import { colors, coverHeightForWidth, formatPrice, radii, space } from "../../lib/theme";

type AdminSection = "moderation" | "narration" | "users";
type AdminTab = "queue" | "library" | "reports" | "series";
type AudioTab = "general" | "casting";
type LibraryFilter = "listed" | "featured" | "rejected" | "hidden" | "removed";

type AdminCounts = {
  pending_count: number;
  library_count: number;
  report_count: number;
  series_count: number;
  library_counts: Record<LibraryFilter, number>;
  report_counts: Record<ReportStatus, number>;
};

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  role: UserRole;
  created_at: string;
  book_count: number;
};

const EMPTY_COUNTS: AdminCounts = {
  pending_count: 0,
  library_count: 0,
  report_count: 0,
  series_count: 0,
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

const SECTIONS: Array<{ value: AdminSection; label: string }> = [
  { value: "moderation", label: "Content" },
  { value: "narration", label: "Audio" },
  { value: "users", label: "Users" },
];

function sectionFromParam(raw: string | string[] | undefined): AdminSection {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "audio" || value === "narration") return "narration";
  if (value === "users") return "users";
  return "moderation";
}

export default function AdminQueueScreen() {
  const router = useRouter();
  const { section: sectionParam } = useLocalSearchParams<{ section?: string }>();
  const { user, api, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [counts, setCounts] = useState<AdminCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<AdminSection>(() => sectionFromParam(sectionParam));
  const [tab, setTab] = useState<AdminTab>("library");
  const [audioTab, setAudioTab] = useState<AudioTab>("general");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("listed");
  const [reportStatus, setReportStatus] = useState<ReportStatus>("open");
  const [query, setQuery] = useState("");
  const [castQuery, setCastQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [castBooks, setCastBooks] = useState<BookListItem[]>([]);

  useEffect(() => {
    const next = sectionFromParam(sectionParam);
    setSection((current) => (current === next ? current : next));
  }, [sectionParam]);

  const loadModeration = useCallback(async () => {
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
      } else if (tab === "series") {
        const [data, summary] = await Promise.all([
          api.listSeries({ all: true }),
          summaryPromise,
        ]);
        setSeriesList(data.series);
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

  const loadUsers = useCallback(async () => {
    setError("");
    try {
      const data = await api.adminListUsers({ q: userQuery || undefined, limit: 50 });
      setUsers(data.users);
      const summary = await api.adminSummary().catch(() => null);
      if (summary) setCounts(summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load users.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, userQuery]);

  const loadCastingBooks = useCallback(async () => {
    setError("");
    try {
      const [queue, listed, summary] = await Promise.all([
        api.adminQueue(),
        api.adminListBooks({
          status: "published",
          visibility: "listed",
          q: castQuery || undefined,
        }),
        api.adminSummary().catch(() => null),
      ]);
      if (summary) setCounts(summary);
      const byId = new Map<string, BookListItem>();
      for (const book of [...queue.books, ...listed.books]) {
        if (castQuery.trim()) {
          const needle = castQuery.trim().toLowerCase();
          const hay = `${book.title} ${book.publisher_name || ""}`.toLowerCase();
          if (!hay.includes(needle)) continue;
        }
        byId.set(book.id, book);
      }
      setCastBooks(
        Array.from(byId.values()).sort((a, b) => {
          const aReady = a.cast_status === "ready" ? 1 : 0;
          const bReady = b.cast_status === "ready" ? 1 : 0;
          if (aReady !== bReady) return aReady - bReady;
          return a.title.localeCompare(b.title);
        })
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load books for casting.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, castQuery]);

  const load = useCallback(async () => {
    if (section === "moderation") {
      await loadModeration();
      return;
    }
    if (section === "users") {
      await loadUsers();
      return;
    }
    if (audioTab === "casting") {
      await loadCastingBooks();
      return;
    }
    // General TTS panel loads itself.
    const summary = await api.adminSummary().catch(() => null);
    if (summary) setCounts(summary);
    setLoading(false);
    setRefreshing(false);
  }, [api, audioTab, loadCastingBooks, loadModeration, loadUsers, section]);

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

  useEffect(() => {
    if (section !== "users") return;
    const timer = setTimeout(() => {
      setLoading(true);
      void loadUsers();
    }, 250);
    return () => clearTimeout(timer);
  }, [userQuery, section, loadUsers]);

  useEffect(() => {
    if (section !== "narration" || audioTab !== "casting") return;
    const timer = setTimeout(() => {
      setLoading(true);
      void loadCastingBooks();
    }, 250);
    return () => clearTimeout(timer);
  }, [castQuery, section, audioTab, loadCastingBooks]);

  const showFullScreenLoader =
    authLoading || (loading && !(section === "narration" && audioTab === "general"));

  if (showFullScreenLoader) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  const tabCounts: Record<AdminTab, number> = {
    queue: counts.pending_count,
    library: counts.library_counts.listed,
    reports: counts.report_count,
    series: counts.series_count,
  };

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
              .then(loadModeration)
              .catch((err) =>
                setError(err instanceof ApiError ? err.message : "Could not update report.")
              );
          },
        },
      ]
    );
  }

  function confirmRoleChange(target: AdminUserRow, next: "reader" | "publisher") {
    Alert.alert(
      next === "publisher" ? "Make publisher?" : "Make reader?",
      `${target.name} (${target.email}) → ${next}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            void api
              .adminUpdateUserRole(target.id, next)
              .then((result) => {
                setUsers((prev) =>
                  prev.map((row) => (row.id === result.user.id ? result.user : row))
                );
              })
              .catch((err) =>
                setError(err instanceof ApiError ? err.message : "Could not update role.")
              );
          },
        },
      ]
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
      <Stack.Screen options={{ title: "Admin" }} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sectionRow}
      >
        {SECTIONS.map((item) => {
          const active = section === item.value;
          return (
            <Pressable
              key={item.value}
              style={[styles.sectionChip, active && styles.sectionChipActive]}
              onPress={() => {
                setError("");
                setLoading(item.value !== "narration" || audioTab === "casting");
                setSection(item.value);
                const param =
                  item.value === "narration"
                    ? "audio"
                    : item.value === "users"
                      ? "users"
                      : "content";
                router.setParams({ section: param });
              }}
            >
              <Text style={[styles.sectionText, active && styles.sectionTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {section === "narration" ? (
        <>
          <View style={styles.tabs}>
            {(
              [
                { value: "general" as const, label: "General" },
                { value: "casting" as const, label: "Book casting" },
              ] as const
            ).map((item) => (
              <Pressable
                key={item.value}
                style={[styles.tab, audioTab === item.value && styles.tabActive]}
                onPress={() => {
                  setError("");
                  setLoading(item.value === "casting");
                  setAudioTab(item.value);
                }}
              >
                <Text style={[styles.tabText, audioTab === item.value && styles.tabTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {audioTab === "general" ? <AdminNarrationPanel /> : null}

          {audioTab === "casting" ? (
            <>
              <Text style={styles.meta}>
                Open a book to edit speaking voices without going through Content.
              </Text>
              <SearchField
                value={castQuery}
                onChangeText={setCastQuery}
                placeholder="Search title or publisher"
              />
              <View style={styles.list}>
                {castBooks.length === 0 ? (
                  <Text style={styles.meta}>No books to cast yet.</Text>
                ) : (
                  castBooks.map((book) => (
                    <Pressable
                      key={book.id}
                      style={styles.row}
                      onPress={() => router.push(`/admin/${book.id}/audio`)}
                    >
                      <View style={styles.rowTop}>
                        <Text style={styles.rowTitle}>{book.title}</Text>
                        <Text
                          style={[
                            styles.badge,
                            book.cast_status === "ready" && styles.castReady,
                          ]}
                        >
                          {book.cast_status === "ready" ? "Ready" : "Draft"}
                        </Text>
                      </View>
                      <Text style={styles.rowMeta}>
                        {book.publisher_name || "Publisher"}
                        {book.status === "pending_review" ? " · In review" : ""}
                        {book.status === "published" ? " · Published" : ""}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {section === "users" ? (
        <>
          <SearchField
            value={userQuery}
            onChangeText={setUserQuery}
            placeholder="Search name, email, or handle"
          />
          <View style={styles.list}>
            {users.length === 0 ? (
              <Text style={styles.meta}>No users found.</Text>
            ) : (
              users.map((row) => (
                <View key={row.id} style={styles.userRow}>
                  <View style={styles.userCopy}>
                    <Text style={styles.rowTitle}>{row.name}</Text>
                    <Text style={styles.rowMeta}>
                      {row.handle ? `@${row.handle} · ` : ""}
                      {row.email}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {row.role}
                      {row.role === "publisher"
                        ? ` · ${row.book_count} book${row.book_count === 1 ? "" : "s"}`
                        : ""}
                    </Text>
                  </View>
                  {row.role === "admin" ? (
                    <Text style={styles.adminLock}>Admin</Text>
                  ) : (
                    <View style={styles.userActions}>
                      {row.role !== "reader" ? (
                        <SmallAction
                          label="Reader"
                          onPress={() => confirmRoleChange(row, "reader")}
                        />
                      ) : null}
                      {row.role !== "publisher" ? (
                        <SmallAction
                          label="Publisher"
                          onPress={() => confirmRoleChange(row, "publisher")}
                        />
                      ) : null}
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        </>
      ) : null}

      {section === "moderation" ? (
        <>
          <View style={styles.tabs}>
            {(["queue", "library", "series", "reports"] as AdminTab[]).map((item) => (
              <Pressable
                key={item}
                style={[styles.tab, tab === item && styles.tabActive]}
                onPress={() => {
                  setLoading(true);
                  setTab(item);
                }}
              >
                <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>
                  {item[0].toUpperCase() + item.slice(1)} {tabCounts[item]}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === "library" ? (
            <>
              <SearchField
                value={query}
                onChangeText={setQuery}
                placeholder="Search title or publisher"
              />
              <View style={styles.filters}>
                {(
                  ["listed", "featured", "rejected", "hidden", "removed"] as LibraryFilter[]
                ).map((item) => (
                  <FilterChip
                    key={item}
                    label={`${item[0].toUpperCase() + item.slice(1)} (${counts.library_counts[item]})`}
                    active={libraryFilter === item}
                    onPress={() => {
                      setLoading(true);
                      setLibraryFilter(item);
                    }}
                  />
                ))}
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
                        {report.reporter_name} ·{" "}
                        {new Date(report.created_at).toLocaleString()}
                      </Text>
                      {report.details ? (
                        <Text style={styles.reportDetails}>{report.details}</Text>
                      ) : null}
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
          ) : tab === "series" ? (
            <View style={styles.list}>
              {seriesList.length === 0 ? (
                <Text style={styles.meta}>No series yet.</Text>
              ) : (
                seriesList.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.row}
                    onPress={() => router.push(`/publisher/series/${item.id}`)}
                  >
                    <View style={styles.seriesAdminRow}>
                      <BookCover
                        title={item.title}
                        coverUrl={api.bookCoverUrl(item.cover_url, { cacheKey: item.updated_at })}
                        width={40}
                        height={coverHeightForWidth(40)}
                        showTitle={false}
                      />
                      <View style={{ flex: 1 }}>
                        <View style={styles.rowTop}>
                          <Text style={styles.rowTitle}>{item.title}</Text>
                          <Text style={styles.badge}>
                            {item.episode_count} ep{item.episode_count === 1 ? "" : "s"}
                          </Text>
                        </View>
                        <Text style={styles.rowMeta}>
                          {item.publisher_name || "Publisher"}
                          {item.publisher_handle ? ` · @${item.publisher_handle}` : ""}
                          {item.visibility === "hidden" ? " · Hidden" : ""}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          ) : (
            <View style={styles.list}>
              {books.length === 0 ? (
                <Text style={styles.meta}>
                  {tab === "queue"
                    ? "No books waiting for review."
                    : "No books in this view."}
                </Text>
              ) : (
                books.map((book) => {
                  const code = formatEpisodeCode(book.season_number, book.episode_number);
                  return (
                    <Pressable
                      key={book.id}
                      style={styles.row}
                      onPress={() => router.push(`/admin/${book.id}`)}
                    >
                      <View style={styles.rowTop}>
                        <Text style={styles.rowTitle}>{book.title}</Text>
                        {book.featured ? (
                          <Text style={styles.featured}>Featured</Text>
                        ) : null}
                      </View>
                      {book.series ? (
                        <Text style={styles.seriesMeta}>
                          {book.series.title}
                          {code ? ` · ${code}` : ""}
                        </Text>
                      ) : null}
                      <Text style={styles.rowMeta}>
                        {book.category?.label ? `${book.category.label} · ` : ""}
                        {book.publisher_name} · {formatPrice(book.price_cents)}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {bookActivityLine(book, { includeFilename: false })}
                        {book.visibility && book.visibility !== "listed"
                          ? ` · ${book.visibility}`
                          : ""}
                        {book.report_count
                          ? ` · ${book.report_count} open report(s)`
                          : ""}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
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
  container: { paddingHorizontal: 20, paddingTop: 12, gap: 8, paddingBottom: 48 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  sectionRow: { gap: 8, paddingVertical: 2 },
  sectionChip: {
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  sectionChipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  sectionText: { color: colors.ink, fontWeight: "600", fontSize: 13 },
  sectionTextActive: { color: colors.white },
  tabs: { flexDirection: "row", gap: 8, marginTop: 2 },
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
  tabActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tabText: { color: colors.ink, fontWeight: "600", fontSize: 12 },
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
    marginTop: 4,
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
  userRow: {
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  userCopy: { flex: 1, gap: 3, minWidth: 0 },
  userActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, maxWidth: 140, justifyContent: "flex-end" },
  adminLock: {
    color: colors.sageDeep,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { fontSize: 17, fontWeight: "600", color: colors.ink },
  seriesAdminRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  seriesMeta: {
    color: colors.inkSoft,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  seriesLink: {
    color: colors.sage,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
    textDecorationLine: "underline",
  },
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
  castReady: { color: colors.sage },
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
  error: { color: colors.danger, marginTop: 4 },
});
