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

export type ReadingMode = "scroll" | "pages";

const DEFAULT_FONT_SIZE = 19;
const DEFAULT_THEME: ReaderThemeKey = "paper";
const DEFAULT_READING_MODE: ReadingMode = "scroll";
const FONT_SIZE_KEY = "reader_font_size";
const THEME_KEY = "reader_theme";
const MODE_KEY = "reader_reading_mode";

type ReaderPreferencesValue = {
  fontSize: number;
  theme: ReaderThemeKey;
  readingMode: ReadingMode;
  changeFontSize: (delta: number) => void;
  cycleTheme: () => void;
  setReadingMode: (mode: ReadingMode) => void;
  cycleReadingMode: () => void;
};

const ReaderPreferencesContext = createContext<ReaderPreferencesValue | null>(null);

function clampFontSize(value: number) {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
}

function isThemeKey(value: string | null): value is ReaderThemeKey {
  return value !== null && value in readerThemes;
}

function isReadingMode(value: string | null): value is ReadingMode {
  return value === "scroll" || value === "pages";
}

/**
 * Reader settings live above the chapter screen so moving to the next chapter
 * does not remount them, and are persisted so they survive app restarts.
 */
export function ReaderPreferencesProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [theme, setTheme] = useState<ReaderThemeKey>(DEFAULT_THEME);
  const [readingMode, setReadingModeState] = useState<ReadingMode>(DEFAULT_READING_MODE);
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [storedFontSize, storedTheme, storedMode] = await Promise.all([
          SecureStore.getItemAsync(FONT_SIZE_KEY),
          SecureStore.getItemAsync(THEME_KEY),
          SecureStore.getItemAsync(MODE_KEY),
        ]);
        if (cancelled) return;

        const parsed = Number(storedFontSize);
        if (Number.isFinite(parsed) && parsed > 0) setFontSize(clampFontSize(parsed));
        if (isThemeKey(storedTheme)) setTheme(storedTheme);
        if (isReadingMode(storedMode)) setReadingModeState(storedMode);
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
    void SecureStore.setItemAsync(MODE_KEY, readingMode);
  }, [fontSize, theme, readingMode]);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize((current) => clampFontSize(current + delta));
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme((current) => {
      const keys = Object.keys(readerThemes) as ReaderThemeKey[];
      return keys[(keys.indexOf(current) + 1) % keys.length];
    });
  }, []);

  const setReadingMode = useCallback((mode: ReadingMode) => {
    setReadingModeState(mode);
  }, []);

  const cycleReadingMode = useCallback(() => {
    setReadingModeState((current) => (current === "scroll" ? "pages" : "scroll"));
  }, []);

  const value = useMemo(
    () => ({
      fontSize,
      theme,
      readingMode,
      changeFontSize,
      cycleTheme,
      setReadingMode,
      cycleReadingMode,
    }),
    [
      fontSize,
      theme,
      readingMode,
      changeFontSize,
      cycleTheme,
      setReadingMode,
      cycleReadingMode,
    ]
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
