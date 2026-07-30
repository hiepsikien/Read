import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, coverInitials, coverPalette, radii, shadows } from "../lib/theme";

type Props = {
  title: string;
  categorySlug?: string | null;
  categoryLabel?: string | null;
  coverUrl?: string | null;
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
  showTitle?: boolean;
};

export function BookCover({
  title,
  categorySlug,
  categoryLabel,
  coverUrl,
  width = 120,
  height = 180,
  style,
  showTitle = true,
}: Props) {
  const palette = coverPalette(categorySlug || title);
  const initials = coverInitials(title);

  return (
    <View style={[styles.frame, { width, height }, shadows.soft, style]}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.placeholder, { backgroundColor: palette.from }]}>
          <View style={[styles.placeholderWash, { backgroundColor: palette.to }]} />
          <Text style={[styles.initials, { color: palette.ink }]}>{initials}</Text>
          {showTitle ? (
            <Text style={[styles.placeholderTitle, { color: palette.ink }]} numberOfLines={3}>
              {title}
            </Text>
          ) : null}
          {categoryLabel ? (
            <Text style={[styles.placeholderCategory, { color: palette.ink }]} numberOfLines={1}>
              {categoryLabel}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.sand,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    flex: 1,
    padding: 12,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  placeholderWash: {
    position: "absolute",
    top: -20,
    right: -30,
    width: "70%",
    height: "55%",
    borderBottomLeftRadius: 80,
    opacity: 0.85,
  },
  initials: {
    position: "absolute",
    top: 14,
    left: 12,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1,
    opacity: 0.9,
  },
  placeholderTitle: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  placeholderCategory: {
    marginTop: 6,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    opacity: 0.8,
    fontWeight: "600",
  },
});
