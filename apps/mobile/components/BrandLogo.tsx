import { Image, type ImageStyle, type StyleProp } from "react-native";

type BrandLogoProps = {
  variant?: "wordmark" | "mark";
  height?: number;
  style?: StyleProp<ImageStyle>;
};

const SOURCES = {
  wordmark: require("../assets/wordmark.png"),
  mark: require("../assets/mark.png"),
} as const;

const ASPECT = {
  wordmark: 320 / 96,
  mark: 1,
} as const;

export function BrandLogo({
  variant = "wordmark",
  height = variant === "wordmark" ? 28 : 40,
  style,
}: BrandLogoProps) {
  const width = Math.round(height * ASPECT[variant]);
  return (
    <Image
      source={SOURCES[variant]}
      accessibilityLabel="Read"
      style={[{ width, height, resizeMode: "contain" }, style]}
    />
  );
}
