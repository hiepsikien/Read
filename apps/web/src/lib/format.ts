export function formatPrice(priceCents: number) {
  if (priceCents <= 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(priceCents / 100);
}

export function estimateMinutes(wordCount: number) {
  return Math.max(1, Math.round(wordCount / 200));
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
