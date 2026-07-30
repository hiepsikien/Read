import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import { readerThemes, type ReaderThemeKey } from "./theme";

export const MIN_FONT_SIZE = 15;
export const MAX_FONT_SIZE = 28;
export const FONT_SIZE_STEP = 2;

const DEFAULT_FONT_SIZE = 19;
const DEFAULT_THEME: ReaderThemeKey = "paper";
const FONT_SIZE_KEY = "reader_font_size";
const THEME_KEY = "reader_theme";

type ReaderPreferencesValue = {
  fontSize: number;
  theme: ReaderThemeKey;
  changeFontSize: (delta: number) => void;
  cycleTheme: () => void;
};

const ReaderPreferencesContext = createContext<ReaderPreferencesValue | null>(null);

function clampFontSize(value: number) {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
}

function isThemeKey(value: string | null): value is ReaderThemeKey {
  return value !== null && value in readerThemes;
}

/**
 * Reader settings live above the chapter screen so moving to the next chapter
 * does not remount them, and are persisted so they survive app restarts.
 */
export function ReaderPreferencesProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [theme, setTheme] = useState<ReaderThemeKey>(DEFAULT_THEME);
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [storedFontSize, storedTheme] = await Promise.all([
          SecureStore.getItemAsync(FONT_SIZE_KEY),
          SecureStore.getItemAsync(THEME_KEY),
        ]);
        if (cancelled) return;

        const parsed = Number(storedFontSize);
        if (Number.isFinite(parsed) && parsed > 0) setFontSize(clampFontSize(parsed));
        if (isThemeKey(storedTheme)) setTheme(storedTheme);
      } finally {
        if (!cancelled) restored.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Skip the first pass so defaults never overwrite what was just restored.
    if (!restored.current) return;
    void SecureStore.setItemAsync(FONT_SIZE_KEY, String(fontSize));
    void SecureStore.setItemAsync(THEME_KEY, theme);
  }, [fontSize, theme]);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize((current) => clampFontSize(current + delta));
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme((current) => {
      const keys = Object.keys(readerThemes) as ReaderThemeKey[];
      return keys[(keys.indexOf(current) + 1) % keys.length];
    });
  }, []);

  const value = useMemo(
    () => ({ fontSize, theme, changeFontSize, cycleTheme }),
    [fontSize, theme, changeFontSize, cycleTheme]
  );

  return (
    <ReaderPreferencesContext.Provider value={value}>
      {children}
    </ReaderPreferencesContext.Provider>
  );
}

export function useReaderPreferences() {
  const context = useContext(ReaderPreferencesContext);
  if (!context) {
    throw new Error(
      "useReaderPreferences must be used within ReaderPreferencesProvider"
    );
  }
  return context;
}
