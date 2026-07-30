import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BookListItem } from "@read/api-client";
import { useAuth } from "../lib/auth";
import { colors, formatPrice, radii, space } from "../lib/theme";
import { BookCover } from "./BookCover";

type Props = {
  book: BookListItem;
  width: number;
  onPress: () => void;
  onPressPublisher?: () => void;
};

export function BookTile({ book, width, onPress, onPressPublisher }: Props) {
  const { api } = useAuth();
  const coverHeight = Math.round(width * 1.45);
  const coverUrl = api.bookCoverUrl(book.cover_url);

  return (
    <View style={[styles.tile, { width }]}>
      <Pressable onPress={onPress}>
        <BookCover
          title={book.title}
          categorySlug={book.category?.slug}
          categoryLabel={book.category?.label}
          coverUrl={coverUrl}
          width={width}
          height={coverHeight}
        />
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
      </Pressable>
      {onPressPublisher ? (
        <Pressable onPress={onPressPublisher} hitSlop={6}>
          <Text style={[styles.meta, styles.metaLink]} numberOfLines={1}>
            {book.publisher_name || "Publisher"}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.meta} numberOfLines={1}>
          {book.publisher_name || "Publisher"}
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
