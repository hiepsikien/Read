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
import { Link, useFocusEffect, useRouter } from "expo-router";
import type { BookListItem } from "@read/api-client";
import { useAuth } from "../lib/auth";
import { colors, formatPrice } from "../lib/theme";

export default function LibraryScreen() {
  const router = useRouter();
  const { user, api, signOut, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.listBooks();
      setBooks(data.books);
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
      <Text style={styles.eyebrow}>In-app reading</Text>
      <Text style={styles.brand}>Read</Text>
      <Text style={styles.sub}>
        A calm place for books — free titles open instantly, paid ones unlock after purchase.
      </Text>

      <View style={styles.authRow}>
        {user ? (
          <>
            <Text style={styles.meta}>Signed in as {user.name}</Text>
            <Pressable onPress={signOut} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={styles.primaryBtn} onPress={() => router.push("/login")}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </Pressable>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>Library · {books.length} titles</Text>
      {books.map((book) => (
        <Link key={book.id} href={`/books/${book.id}`} asChild>
          <Pressable style={styles.card}>
            <Text style={styles.cardTitle}>{book.title}</Text>
            <Text style={styles.cardMeta}>
              {book.publisher_name} · {formatPrice(book.price_cents)} · {book.chapter_count} chapters
            </Text>
            <Text style={styles.cardBody} numberOfLines={3}>
              {book.description}
            </Text>
          </Pressable>
        </Link>
      ))}
      {books.length === 0 ? <Text style={styles.meta}>No published books yet.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, paddingBottom: 48 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.sage,
    fontWeight: "600",
  },
  brand: { fontSize: 44, fontWeight: "700", color: colors.ink, marginTop: 2 },
  sub: { color: colors.inkSoft, marginBottom: 8, lineHeight: 21 },
  authRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meta: { color: colors.inkSoft },
  section: {
    marginTop: 12,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 6,
  },
  cardTitle: { fontSize: 20, fontWeight: "600", color: colors.ink },
  cardMeta: { fontSize: 13, color: colors.inkSoft },
  cardBody: { fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: colors.sage,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  secondaryBtnText: { color: colors.ink },
  error: { color: colors.danger },
});
