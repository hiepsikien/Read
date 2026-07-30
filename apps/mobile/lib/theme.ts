export const colors = {
  mist: "#eef3f0",
  paper: "#f3f7f5",
  ink: "#14221c",
  inkSoft: "#2a3d34",
  line: "rgba(20,34,28,0.10)",
  sage: "#3f6f5c",
  sageDeep: "#2f5445",
  card: "rgba(255,255,255,0.7)",
  danger: "#9b1c1c",
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
