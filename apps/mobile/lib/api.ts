import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { createApiClient, type SessionUser } from "@read/api-client";

const TOKEN_KEY = "read_token";

export function getApiBaseUrl() {
  return (
    process.env.EXPO_PUBLIC_API_URL ||
    Constants.expoConfig?.extra?.apiUrl ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null) {
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export function createMobileApi(token?: string | null) {
  return createApiClient({
    baseUrl: getApiBaseUrl(),
    getToken: () => token ?? null,
  });
}

export type { SessionUser };
