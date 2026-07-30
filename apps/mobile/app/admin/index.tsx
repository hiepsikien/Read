import { useCallback, useState } from "react";
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
import { ApiError, type BookListItem } from "@read/api-client";
import { useAuth } from "../../lib/auth";
import { colors, formatPrice } from "../../lib/theme";

export default function AdminQueueScreen() {
  const router = useRouter();
  const { user, api, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.adminQueue();
      setBooks(data.books);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load queue.");
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
      <Text style={styles.title}>Review queue</Text>
      <Text style={styles.sub}>
        Approve original manuscripts for the public library, or reject with a clear note for the author.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.list}>
        {books.length === 0 ? (
          <Text style={styles.meta}>No books waiting for review.</Text>
        ) : (
          books.map((book) => (
            <Pressable
              key={book.id}
              style={styles.row}
              onPress={() => router.push(`/admin/${book.id}`)}
            >
              <Text style={styles.rowTitle}>{book.title}</Text>
              <Text style={styles.rowMeta}>
                {book.category?.label ? `${book.category.label} · ` : ""}
                {book.publisher_name} · {formatPrice(book.price_cents)} · {book.chapter_count} chapters
              </Text>
              {book.submitted_at ? (
                <Text style={styles.rowMeta}>Submitted {new Date(book.submitted_at).toLocaleString()}</Text>
              ) : null}
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
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
  sub: { color: colors.inkSoft, lineHeight: 21, marginTop: 6, marginBottom: 8 },
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
  rowTitle: { fontSize: 18, fontWeight: "600", color: colors.ink },
  rowMeta: { fontSize: 13, color: colors.inkSoft },
  meta: { color: colors.inkSoft, padding: 16 },
  error: { color: colors.danger, marginTop: 8 },
});
