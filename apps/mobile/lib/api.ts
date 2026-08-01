import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { createApiClient, type SessionUser } from "@read/api-client";

const TOKEN_KEY = "read_token";
const API_PORT = 8000;

/** Last known bearer for audio segment fetches (survives SecureStore lock failures). */
let playbackTokenCache: string | null = null;

function hostFromExpo(): string | null {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
    Constants.manifest2?.extra?.expoGo?.debuggerHost,
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const host = candidate.split(":")[0]?.trim();
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return host;
    }
  }
  return null;
}

export function getApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, "");
  }

  const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  if (configured && !/localhost|127\.0\.0\.1/.test(configured)) {
    return configured.replace(/\/$/, "");
  }

  const lanHost = hostFromExpo();
  if (lanHost) {
    return `http://${lanHost}:${API_PORT}`;
  }

  return (configured || "http://localhost:8000").replace(/\/$/, "");
}

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null) {
  if (token) {
    playbackTokenCache = token;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    playbackTokenCache = null;
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

/**
 * Auth token for cloud narration headers.
 *
 * Prefer Firebase's in-memory ID token (works while the device is locked), then
 * SecureStore, then the last token we successfully used this session. Never
 * throw — a missing token must not force the offline-voice fallback.
 */
export async function resolvePlaybackAuthToken(): Promise<string | null> {
  try {
    const { getFirebaseIdToken, firebaseConfigured } = await import("./firebase");
    if (firebaseConfigured()) {
      const idToken = await getFirebaseIdToken();
      if (idToken) {
        playbackTokenCache = idToken;
        return idToken;
      }
    }
  } catch {
    // Firebase unavailable / locked — try SecureStore / cache.
  }

  try {
    const stored = await getToken();
    if (stored) {
      playbackTokenCache = stored;
      return stored;
    }
  } catch {
    // Keychain/SecureStore often fails while the device is locked.
  }

  return playbackTokenCache;
}

export function createMobileApi(
  getTokenFn?: () => string | null | undefined | Promise<string | null | undefined>
) {
  return createApiClient({
    baseUrl: getApiBaseUrl(),
    getToken: getTokenFn,
  });
}

export type { SessionUser };
