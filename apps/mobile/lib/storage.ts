type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const memory = new Map<string, string>();

const memoryStorage: StorageLike = {
  getItem: async (key) => (memory.has(key) ? memory.get(key)! : null),
  setItem: async (key, value) => {
    memory.set(key, value);
  },
  removeItem: async (key) => {
    memory.delete(key);
  },
};

let native: StorageLike | null | undefined;

/**
 * AsyncStorage throws at import time when the native module is missing
 * (stale dev client, web, Expo Go mismatch). Never import it at module top.
 */
export function nativeAsyncStorage(): StorageLike | null {
  if (native !== undefined) return native;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    const storage = mod?.default ?? mod;
    native = storage && typeof storage.getItem === "function" ? storage : null;
  } catch {
    native = null;
  }
  return native;
}

export const appStorage: StorageLike = nativeAsyncStorage() ?? memoryStorage;
