import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, useFocusEffect } from "expo-router";
import type { BookListItem, SessionUser } from "@read/api-client";
import { createMobileApi, getToken, setToken } from "../lib/api";

export default function LibraryScreen() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const api = createMobileApi(token);
      if (token) {
        const me = await api.me();
        setUser(me.user);
      } else {
        setUser(null);
      }
      const data = await api.listBooks();
      setBooks(data.books);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function logout() {
    await setToken(null);
    setUser(null);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#3f6f5c" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.brand}>Read</Text>
      <Text style={styles.sub}>
        Mobile scaffold (Expo) — same FastAPI backend as the web app.
      </Text>

      <View style={styles.authRow}>
        {user ? (
          <>
            <Text style={styles.meta}>Signed in as {user.name}</Text>
            <Pressable onPress={logout} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <Link href="/login" asChild>
            <Pressable style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Sign in</Text>
            </Pressable>
          </Link>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>Library</Text>
      {books.map((book) => (
        <View key={book.id} style={styles.card}>
          <Text style={styles.cardTitle}>{book.title}</Text>
          <Text style={styles.cardMeta}>
            {book.publisher_name} · {book.price_cents <= 0 ? "Free" : `$${(book.price_cents / 100).toFixed(2)}`} ·{" "}
            {book.chapter_count} chapters
          </Text>
          <Text style={styles.cardBody}>{book.description}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  brand: { fontSize: 40, fontWeight: "700", color: "#14221c" },
  sub: { color: "#2a3d34", marginBottom: 8 },
  authRow: { gap: 8, marginBottom: 8 },
  meta: { color: "#2a3d34" },
  section: {
    marginTop: 8,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#3f6f5c",
    fontWeight: "600",
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(20,34,28,0.08)",
    gap: 6,
  },
  cardTitle: { fontSize: 20, fontWeight: "600", color: "#14221c" },
  cardMeta: { fontSize: 13, color: "#2a3d34" },
  cardBody: { fontSize: 14, color: "#2a3d34", lineHeight: 20 },
  primaryBtn: {
    backgroundColor: "#3f6f5c",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "rgba(20,34,28,0.15)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  secondaryBtnText: { color: "#14221c" },
  error: { color: "#9b1c1c" },
});
