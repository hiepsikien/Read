import { Image, type ImageStyle, type StyleProp } from "react-native";

type BrandLogoProps = {
  variant?: "wordmark" | "mark";
  tone?: "color" | "ink" | "white";
  height?: number;
  style?: StyleProp<ImageStyle>;
};

const SOURCES = {
  wordmark: {
    color: require("../assets/wordmark.png"),
    ink: require("../assets/wordmark-ink.png"),
    white: require("../assets/wordmark-white.png"),
  },
  mark: {
    color: require("../assets/mark.png"),
    ink: require("../assets/mark-ink.png"),
    white: require("../assets/mark-white.png"),
  },
} as const;

// Kept in sync with scripts/brand/build.mjs, which prints both ratios.
const ASPECT = {
  wordmark: 702 / 354,
  mark: 143 / 125,
} as const;

export function BrandLogo({
  variant = "wordmark",
  tone = "color",
  height = variant === "wordmark" ? 28 : 40,
  style,
}: BrandLogoProps) {
  const width = Math.round(height * ASPECT[variant]);
  return (
    <Image
      source={SOURCES[variant][tone]}
      accessibilityLabel="Read"
      style={[{ width, height, resizeMode: "contain" }, style]}
    />
  );
}
