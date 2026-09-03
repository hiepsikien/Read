import { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from "react-native";
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

type LoadState = "loading" | "ready" | "failed";

async function authToken(): Promise<string | null> {
  if (firebaseConfigured()) {
    return (await getFirebaseIdToken()) || (await getToken());
  }
  return getToken();
}

/** Loads an API image with optional auth (drafts) via Image headers. */
export function AuthenticatedImage({
  url,
  style,
  authenticated = true,
  accessibilityLabel,
  fillWidth = false,
}: Props) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [authReady, setAuthReady] = useState(!authenticated);
  const [useAuth, setUseAuth] = useState(authenticated);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAspectRatio(null);
    setLoadState("loading");
    setUseAuth(authenticated);
    if (!authenticated) {
      setAuthReady(true);
      setToken(null);
      return;
    }
    setAuthReady(false);
    void (async () => {
      const nextToken = await authToken();
      if (cancelled) return;
      setToken(nextToken);
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, authenticated]);

  const source = useMemo(
    () => ({
      uri: url,
      ...(useAuth && token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    }),
    [url, useAuth, token]
  );

  useEffect(() => {
    if (loadState !== "ready" || !fillWidth) return;
    let cancelled = false;
    Image.getSize(
      url,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) {
          setAspectRatio(width / height);
        }
      },
      () => {
        if (!cancelled) setAspectRatio(4 / 3);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url, loadState, fillWidth]);

  const frameStyle = [
    style,
    fillWidth ? { width: "100%", aspectRatio: aspectRatio ?? 4 / 3, height: undefined } : null,
  ];

  if (!authReady) {
    return (
      <View
        style={[...frameStyle, { backgroundColor: "rgba(127,127,127,0.08)" }]}
        accessibilityLabel={accessibilityLabel || "Loading illustration"}
      />
    );
  }

  if (loadState === "failed") {
    return (
      <View
        style={[...frameStyle, { backgroundColor: "rgba(127,127,127,0.12)" }]}
        accessibilityLabel={accessibilityLabel || "Illustration unavailable"}
      />
    );
  }

  return (
    <View style={frameStyle}>
      {loadState === "loading" ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: "rgba(127,127,127,0.08)" },
          ]}
        />
      ) : null}
      <Image
        source={source}
        style={fillWidth ? { width: "100%", height: "100%" } : style}
        resizeMode={fillWidth ? "cover" : "contain"}
        accessibilityLabel={accessibilityLabel}
        onLoad={() => setLoadState("ready")}
        onError={() => {
          if (useAuth && token) {
            setUseAuth(false);
            setLoadState("loading");
            return;
          }
          setLoadState("failed");
        }}
      />
    </View>
  );
}