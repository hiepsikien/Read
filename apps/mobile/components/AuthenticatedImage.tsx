import { useEffect, useState } from "react";
import {
  Image,
  useWindowDimensions,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
  type StyleProp,
} from "react-native";
import { getToken } from "../lib/api";
import { getFirebaseIdToken, firebaseConfigured } from "../lib/firebase";

type Props = {
  url: string;
  style?: StyleProp<ImageStyle>;
  authenticated?: boolean;
  accessibilityLabel?: string;
  /** Fit inside the container without upscaling past the image's natural size. */
  fillWidth?: boolean;
  /** Cap the fitted height (defaults to 72% of the window when fillWidth). */
  maxHeight?: number;
};

async function authToken(): Promise<string | null> {
  if (firebaseConfigured()) {
    return (await getFirebaseIdToken()) || (await getToken());
  }
  return getToken();
}

async function fetchImageDataUri(url: string): Promise<string | null> {
  try {
    const token = await authToken();
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${contentType};base64,${globalThis.btoa(binary)}`;
  } catch {
    return null;
  }
}

/** Loads an API image with optional auth (drafts) via data URI. */
export function AuthenticatedImage({
  url,
  style,
  authenticated = true,
  accessibilityLabel,
  fillWidth = false,
  maxHeight,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(authenticated ? null : url);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const heightCap = maxHeight ?? Math.round(windowHeight * 0.72);

  useEffect(() => {
    let cancelled = false;
    if (!authenticated) {
      setUri(url);
      return;
    }
    setUri(null);
    setNatural(null);
    void (async () => {
      const dataUri = await fetchImageDataUri(url);
      if (!cancelled) setUri(dataUri);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, authenticated]);

  useEffect(() => {
    if (!uri || !fillWidth) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) {
          setNatural({ width, height });
        }
      },
      () => {
        if (!cancelled) setNatural(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri, fillWidth]);

  function onBoxLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - boxWidth) > 0.5) setBoxWidth(next);
  }

  if (!uri) return null;

  if (!fillWidth) {
    return (
      <Image
        source={{ uri }}
        style={style}
        resizeMode="contain"
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  const fitted =
    natural && boxWidth > 0
      ? fitImageSize(natural.width, natural.height, boxWidth, heightCap)
      : null;

  return (
    <View onLayout={onBoxLayout} style={{ alignSelf: "stretch", alignItems: "center" }}>
      {fitted ? (
        <Image
          source={{ uri }}
          style={[style, { width: fitted.width, height: fitted.height }]}
          resizeMode="contain"
          accessibilityLabel={accessibilityLabel}
        />
      ) : null}
    </View>
  );
}

function fitImageSize(
  naturalWidth: number,
  naturalHeight: number,
  boxWidth: number,
  maxHeight: number
) {
  const maxWidth = boxWidth > 0 ? boxWidth : naturalWidth;
  const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}
