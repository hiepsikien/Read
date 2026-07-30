import { cn } from "@/lib/format";

type BrandLogoProps = {
  variant?: "wordmark" | "mark";
  /** color = original; ink = mono dark; white = mono light (dark UI) */
  tone?: "color" | "ink" | "white";
  className?: string;
  height?: number;
  priority?: boolean;
  alt?: string;
  /** Prefer SVG for crisp header scaling; PNG for hero raster fidelity */
  format?: "svg" | "png";
};

const ASPECT = {
  wordmark: 823 / 354,
  mark: 1,
} as const;

function brandSrc(
  variant: "wordmark" | "mark",
  tone: "color" | "ink" | "white",
  format: "svg" | "png"
) {
  const base = variant === "wordmark" ? "read-wordmark" : "read-mark";
  if (tone === "color") return `/brand/${base}.${format}`;
  return `/brand/${base}-${tone}.${format === "svg" ? "svg" : "png"}`;
}

/**
 * Brand asset helper.
 * - wordmark: full "Read" + book (use alone — do not also render text "Read")
 * - mark: book-only icon for compact chrome / app icons
 */
export function BrandLogo({
  variant = "wordmark",
  tone = "color",
  className,
  height = variant === "wordmark" ? 32 : 40,
  priority = false,
  alt = "Read",
  format = "svg",
}: BrandLogoProps) {
  const width = Math.round(height * ASPECT[variant]);
  const src = brandSrc(variant, tone, format);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
      className={cn("object-contain", className)}
      style={{ width, height }}
    />
  );
}
