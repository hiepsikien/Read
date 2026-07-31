import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { getToken } from "../lib/api";
import { getFirebaseIdToken, firebaseConfigured } from "../lib/firebase";
import { colors, coverHeightForWidth, coverInitials, coverPalette, radii, shadows } from "../lib/theme";

type Props = {
  title: string;
  categorySlug?: string | null;
  categoryLabel?: string | null;
  coverUrl?: string | null;
  /** Local file/content URI shown immediately (e.g. just-picked cover). */
  localUri?: string | null;
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
  showTitle?: boolean;
  /** When true (default), fetch cover with auth so draft covers load for the owner. */
  authenticated?: boolean;
};

async function authToken(): Promise<string | null> {
  if (firebaseConfigured()) {
    return (await getFirebaseIdToken()) || (await getToken());
  }
  return getToken();
}

async function fetchCoverDataUri(url: string): Promise<string | null> {
  try {
    const token = await authToken();
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:image/jpeg;base64,${globalThis.btoa(binary)}`;
  } catch {
    return null;
  }
}

export function BookCover({
  title,
  categorySlug,
  categoryLabel,
  coverUrl,
  localUri,
  width = 120,
  height = coverHeightForWidth(120),
  style,
  showTitle = true,
  authenticated = true,
}: Props) {
  const palette = coverPalette(categorySlug || title);
  const initials = coverInitials(title);
  const [remoteUri, setRemoteUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRemoteUri(null);
    if (!coverUrl || localUri) return;

    if (!authenticated) {
      setRemoteUri(coverUrl);
      return;
    }

    void (async () => {
      const dataUri = await fetchCoverDataUri(coverUrl);
      if (!cancelled) setRemoteUri(dataUri);
    })();

    return () => {
      cancelled = true;
    };
  }, [coverUrl, localUri, authenticated]);

  const imageUri = localUri || remoteUri;

  return (
    <View style={[styles.frame, { width, height }, shadows.soft, style]}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
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
