import { useEffect, useState } from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";
import { getToken } from "../lib/api";
import { getFirebaseIdToken, firebaseConfigured } from "../lib/firebase";

type Props = {
  url: string;
  style?: StyleProp<ImageStyle>;
  authenticated?: boolean;
  accessibilityLabel?: string;
  /** When true, height follows natural aspect ratio at full container width. */
  fillWidth?: boolean;
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
}: Props) {
  const [uri, setUri] = useState<string | null>(authenticated ? null : url);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!authenticated) {
      setUri(url);
      return;
    }
    setUri(null);
    setAspectRatio(null);
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
          setAspectRatio(width / height);
        }
      },
      () => {
        if (!cancelled) setAspectRatio(4 / 3);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri, fillWidth]);

  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={[
        style,
        fillWidth
          ? { width: "100%", aspectRatio: aspectRatio ?? 4 / 3, height: undefined }
          : null,
      ]}
      resizeMode={fillWidth ? "cover" : "contain"}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
