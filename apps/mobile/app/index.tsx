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
import { BrandLogo } from "../components/BrandLogo";
import { useAuth } from "../lib/auth";
import { colors, formatPrice } from "../lib/theme";

export default function LibraryScreen() {
  const router = useRouter();
  const { user, api, signOut, enableAuthor, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [authorBusy, setAuthorBusy] = useState(false);

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

  async function becomeAuthor() {
    setAuthorBusy(true);
    setError("");
    try {
      await enableAuthor();
      router.push("/publisher");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable author mode.");
    } finally {
      setAuthorBusy(false);
    }
  }

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
      <BrandLogo variant="wordmark" height={44} style={styles.brandLogo} />
      <Text style={styles.sub}>
        Free titles open instantly. Paid titles unlock after sign-in and purchase. Authors publish
        original DOCX manuscripts for review.
      </Text>

      <View style={styles.authRow}>
        {user ? (
          <>
            <Text style={styles.meta}>Signed in as {user.name}</Text>
            <View style={styles.authActions}>
              {user.role === "admin" ? (
                <Pressable style={styles.secondaryBtn} onPress={() => router.push("/admin")}>
                  <Text style={styles.secondaryBtnText}>Admin</Text>
                </Pressable>
              ) : null}
              {user.role === "publisher" || user.role === "admin" ? (
                <Pressable style={styles.secondaryBtn} onPress={() => router.push("/publisher")}>
                  <Text style={styles.secondaryBtnText}>Publisher</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.secondaryBtn} onPress={becomeAuthor} disabled={authorBusy}>
                  <Text style={styles.secondaryBtnText}>
                    {authorBusy ? "Enabling…" : "Become author"}
                  </Text>
                </Pressable>
              )}
              <Pressable style={styles.secondaryBtn} onPress={() => router.push("/settings")}>
                <Text style={styles.secondaryBtnText}>Settings</Text>
              </Pressable>
              <Pressable onPress={signOut} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Sign out</Text>
              </Pressable>
            </View>
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
              {book.category?.label ? `${book.category.label} · ` : ""}
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
  brandLogo: { marginTop: 6, marginBottom: 4 },
  sub: { color: colors.inkSoft, marginBottom: 8, lineHeight: 21 },
  authRow: { gap: 8 },
  authActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
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
    alignSelf: "flex-start",
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
