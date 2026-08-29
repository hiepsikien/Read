import { Pressable, StyleSheet, Text, View } from "react-native";
import { displayAuthorName, formatEpisodeCode, publisherIsDistinct, type BookListItem } from "@read/api-client";
import { useAuth } from "../lib/auth";
import { colors, coverHeightForWidth, formatPrice, radii, space } from "../lib/theme";
import { BookCover } from "./BookCover";

type Props = {
  book: BookListItem;
  width: number;
  onPress: () => void;
  onPressPublisher?: () => void;
  onPressSeries?: () => void;
};

export function BookTile({ book, width, onPress, onPressPublisher, onPressSeries }: Props) {
  const { api } = useAuth();
  const coverHeight = coverHeightForWidth(width);
  const coverUrl = api.bookCoverUrl(book.cover_url, { cacheKey: book.updated_at });
  const code = formatEpisodeCode(book.season_number, book.episode_number);
  const author = displayAuthorName(book) || "Publisher";
  const linkPublisher = Boolean(onPressPublisher && !publisherIsDistinct(book));

  return (
    <View style={[styles.tile, { width }]}>
      <Pressable onPress={onPress}>
        <View>
          <BookCover
            title={book.title}
            categorySlug={book.category?.slug}
            categoryLabel={book.category?.label}
            coverUrl={coverUrl}
            width={width}
            height={coverHeight}
          />
          {code ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{code}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
      </Pressable>
      {book.series && onPressSeries ? (
        <Pressable onPress={onPressSeries} hitSlop={6}>
          <Text style={[styles.meta, styles.metaLink]} numberOfLines={1}>
            {book.series.title}
          </Text>
        </Pressable>
      ) : linkPublisher ? (
        <Pressable onPress={onPressPublisher} hitSlop={6}>
          <Text style={[styles.meta, styles.metaLink]} numberOfLines={1}>
            {author}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.meta} numberOfLines={1}>
          {book.series?.title || author}
        </Text>
      )}
      <Pressable onPress={onPress}>
        <Text style={styles.price}>{formatPrice(book.price_cents)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    gap: space.sm,
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(20,34,28,0.82)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    lineHeight: 19,
    marginTop: space.sm,
  },
  meta: {
    fontSize: 12,
    color: colors.inkSoft,
  },
  metaLink: {
    color: colors.sage,
    textDecorationLine: "underline",
  },
  price: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.sageDeep,
    backgroundColor: "rgba(63,111,92,0.10)",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
});
