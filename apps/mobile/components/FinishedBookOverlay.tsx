import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError, formatEpisodeCode, type BookListItem } from "@read/api-client";
import { BookTile } from "./BookTile";
import { useAuth } from "../lib/auth";
import { colors, formatPrice, radii, space } from "../lib/theme";

const TILE = Math.min(120, Math.round(Dimensions.get("window").width * 0.3));

type Props = {
  visible: boolean;
  bookId: string;
  bookTitle: string;
  firstChapterId: string | null;
  onClose: () => void;
  onReadAgain: () => void;
  onOpenBook: (id: string) => void;
};

export function FinishedBookOverlay({
  visible,
  bookId,
  bookTitle,
  firstChapterId,
  onClose,
  onReadAgain,
  onOpenBook,
}: Props) {
  const { api, user } = useAuth();
  const [nextEpisode, setNextEpisode] = useState<BookListItem | null>(null);
  const [nextOwned, setNextOwned] = useState<boolean | null>(null);
  const [sameAuthor, setSameAuthor] = useState<BookListItem[]>([]);
  const [related, setRelated] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    void api
      .getBookRecommendations(bookId)
      .then((payload) => {
        if (cancelled) return;
        setNextEpisode(payload.next_episode);
        setNextOwned(payload.next_episode_owned);
        setSameAuthor(payload.same_author);
        setRelated(payload.related);
      })
      .catch(() => {
        if (cancelled) return;
        setNextEpisode(null);
        setNextOwned(null);
        setSameAuthor([]);
        setRelated([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, bookId, visible]);

  async function unlockNext() {
    if (!nextEpisode) return;
    if (!user) {
      Alert.alert("Sign in required", "Sign in to unlock the next episode.");
      return;
    }
    setBuying(true);
    try {
      await api.purchaseBook(nextEpisode.id);
      setNextOwned(true);
      onOpenBook(nextEpisode.id);
    } catch (err) {
      Alert.alert(
        "Could not unlock",
        err instanceof ApiError ? err.message : "Try again from the episode page."
      );
    } finally {
      setBuying(false);
    }
  }

  const code = nextEpisode
    ? formatEpisodeCode(nextEpisode.season_number, nextEpisode.episode_number)
    : null;
  const needsPurchase = Boolean(nextEpisode && nextOwned === false && nextEpisode.price_cents > 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.eyebrow}>Finished</Text>
          <Text style={styles.title}>You finished {bookTitle}</Text>
          <Text style={styles.body}>Nice work. Pick another title, or start this one again.</Text>

          <View style={styles.actions}>
            {nextEpisode ? (
              <Pressable
                style={styles.primary}
                disabled={buying}
                onPress={() => {
                  if (needsPurchase) void unlockNext();
                  else onOpenBook(nextEpisode.id);
                }}
              >
                <Text style={styles.primaryText}>
                  {buying
                    ? "Unlocking…"
                    : needsPurchase
                      ? `Unlock next${code ? ` · ${code}` : ""} · ${formatPrice(nextEpisode.price_cents)}`
                      : `Next episode${code ? ` · ${code}` : ""}`}
                </Text>
              </Pressable>
            ) : (
              <Pressable style={styles.primary} onPress={onClose}>
                <Text style={styles.primaryText}>Back to book</Text>
              </Pressable>
            )}
            {firstChapterId ? (
              <Pressable style={styles.secondary} onPress={onReadAgain}>
                <Text style={styles.secondaryText}>Read again</Text>
              </Pressable>
            ) : null}
            {nextEpisode ? (
              <Pressable style={styles.secondary} onPress={onClose}>
                <Text style={styles.secondaryText}>Back to book</Text>
              </Pressable>
            ) : null}
          </View>

          {loading ? <ActivityIndicator color={colors.sage} style={{ marginTop: 24 }} /> : null}

          {sameAuthor.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>More by this author</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {sameAuthor.map((book) => (
                  <BookTile
                    key={book.id}
                    book={book}
                    width={TILE}
                    onPress={() => onOpenBook(book.id)}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {related.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Related</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {related.map((book) => (
                  <BookTile
                    key={book.id}
                    book={book}
                    width={TILE}
                    onPress={() => onOpenBook(book.id)}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.mist },
  content: { padding: space.xl, paddingBottom: 56, gap: space.lg },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.sage,
    fontWeight: "700",
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink, lineHeight: 34 },
  body: { color: colors.inkSoft, lineHeight: 22, fontSize: 15 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  primary: {
    backgroundColor: colors.sage,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: radii.sm,
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: {
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
  },
  secondaryText: { color: colors.ink, fontWeight: "600" },
  section: { gap: space.md, marginTop: space.sm },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "700",
  },
  row: { gap: space.md, paddingRight: space.xl },
});
