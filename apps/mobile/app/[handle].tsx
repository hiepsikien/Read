import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type BookListItem, type PublicProfile } from "@read/api-client";
import { BookTile } from "../components/BookTile";
import { useAuth } from "../lib/auth";
import { colors, space } from "../lib/theme";

function parseHandleParam(segment?: string): string | null {
  if (!segment || !segment.startsWith("@") || segment.length < 2) return null;
  return segment.slice(1).toLowerCase();
}

export default function PublicProfileScreen() {
  const { handle: segment } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const { api } = useAuth();
  const handle = useMemo(() => parseHandleParam(segment), [segment]);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!handle) {
      setError("Profile not found.");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const data = await api.getProfile(handle);
      setProfile(data.profile);
      setBooks(data.books);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load profile.");
      setProfile(null);
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, [api, handle]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const tileWidth = useMemo(() => {
    const width = Dimensions.get("window").width;
    return Math.floor((width - space.xl * 2 - space.md) / 2);
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: "Profile" }} />
        <Text style={styles.error}>{error || "Profile not found."}</Text>
        <Pressable onPress={() => router.replace("/")}>
          <Text style={styles.back}>Back to library</Text>
        </Pressable>
      </View>
    );
  }

  const roleLabel =
    profile.role === "publisher"
      ? "Author"
      : profile.role === "admin"
        ? "Admin"
        : "Reader";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `@${profile.handle}` }} />
      <FlatList
        data={books}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>@{profile.handle}</Text>
            <Text style={styles.title}>{profile.name}</Text>
            <Text style={styles.role}>{roleLabel}</Text>
            <Text style={styles.section}>
              Published books · {books.length} title{books.length === 1 ? "" : "s"}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No published books yet.</Text>
        }
        renderItem={({ item }) => (
          <BookTile
            book={item}
            width={tileWidth}
            onPress={() => router.push(`/books/${item.id}`)}
            onPressPublisher={
              item.publisher_handle
                ? () => router.push(`/@${item.publisher_handle}`)
                : undefined
            }
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mist },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mist,
    gap: 12,
    padding: space.xl,
  },
  content: { padding: space.xl, paddingBottom: 56, gap: space.lg },
  row: { justifyContent: "space-between", marginBottom: space.lg },
  header: { gap: 6, marginBottom: space.md },
  eyebrow: {
    color: colors.sage,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontSize: 12,
    fontWeight: "700",
  },
  title: { color: colors.ink, fontSize: 30, fontWeight: "700" },
  role: { color: colors.inkSoft },
  section: {
    marginTop: space.md,
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  empty: { color: colors.inkSoft, marginTop: space.md },
  error: { color: colors.danger, textAlign: "center" },
  back: { color: colors.sage, textDecorationLine: "underline" },
});
