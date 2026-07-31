export const colors = {
  mist: "#eef3f0",
  paper: "#f3f7f5",
  ink: "#14221c",
  inkSoft: "#2a3d34",
  line: "rgba(20,34,28,0.10)",
  sage: "#3f6f5c",
  sageDeep: "#2f5445",
  card: "rgba(255,255,255,0.82)",
  danger: "#9b1c1c",
  sand: "#e7efe9",
  white: "#ffffff",
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;

export const shadows = {
  soft: {
    shadowColor: "#14221c",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
} as const;

/** Stable palette keyed by category slug (or fallback hash of title). */
export const CATEGORY_PALETTE: Record<string, { from: string; to: string; ink: string }> = {
  fiction: { from: "#3f6f5c", to: "#1f3d32", ink: "#e8f0ec" },
  romance: { from: "#8b5a6b", to: "#4a2f3a", ink: "#f7ecef" },
  fantasy: { from: "#4a5f8f", to: "#243252", ink: "#e8edf7" },
  "science-fiction": { from: "#2f6f7a", to: "#163840", ink: "#e5f3f5" },
  "mystery-thriller": { from: "#4a4f5c", to: "#23262e", ink: "#eceef2" },
  horror: { from: "#6b3a3a", to: "#321818", ink: "#f3e8e8" },
  "historical-fiction": { from: "#7a6548", to: "#3d3222", ink: "#f4eee4" },
  "literary-fiction": { from: "#556b5a", to: "#2a352e", ink: "#eaf1ec" },
  "young-adult": { from: "#5e7a4f", to: "#2f3d24", ink: "#eef4e8" },
  poetry: { from: "#6a5a7a", to: "#332a3d", ink: "#f1ebf5" },
  essays: { from: "#5a6b6e", to: "#2a3436", ink: "#ebf0f1" },
  "memoir-biography": { from: "#6e5a48", to: "#372d22", ink: "#f4eee7" },
  "self-help": { from: "#3f6f6a", to: "#1f3835", ink: "#e8f3f1" },
  business: { from: "#3f556f", to: "#1f2a38", ink: "#e8eef5" },
  other: { from: "#5a6a60", to: "#2c3530", ink: "#eef2ef" },
};

export const readerThemes = {
  paper: { label: "Paper", bg: "#f3f7f5", fg: "#14221c", muted: "#2a3d34" },
  ink: { label: "Ink", bg: "#14221c", fg: "#e8f0ec", muted: "#b7c7bf" },
  sepia: { label: "Sepia", bg: "#efe6d6", fg: "#2b2118", muted: "#5c4d3d" },
} as const;

export type ReaderThemeKey = keyof typeof readerThemes;

export function estimateMinutes(wordCount: number) {
  return Math.max(1, Math.round(wordCount / 200));
}

export function formatPrice(priceCents: number) {
  if (priceCents <= 0) return "Free";
  return `$${(priceCents / 100).toFixed(2)}`;
}

export function coverPalette(slugOrTitle?: string | null) {
  if (slugOrTitle && CATEGORY_PALETTE[slugOrTitle]) {
    return CATEGORY_PALETTE[slugOrTitle];
  }
  const key = (slugOrTitle || "other").toLowerCase();
  const keys = Object.keys(CATEGORY_PALETTE);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[keys[hash % keys.length]] || CATEGORY_PALETTE.other;
}

/** Portrait book cover width:height for image pickers and frames. */
export const COVER_ASPECT = [3, 4] as const;

export function coverHeightForWidth(width: number) {
  return Math.round((width * COVER_ASPECT[1]) / COVER_ASPECT[0]);
}

export function coverInitials(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "R";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
}
