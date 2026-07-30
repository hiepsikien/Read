import { cn } from "@/lib/format";

type BrandLogoProps = {
  variant?: "wordmark" | "mark";
  className?: string;
  /** CSS height for the rendered asset */
  height?: number;
  priority?: boolean;
  alt?: string;
};

/**
 * Aspect based on the restored original raster wordmark (~823×354)
 * and square mark (1024×1024).
 */
const ASPECT = {
  wordmark: 823 / 354,
  mark: 1,
} as const;

/**
 * Brand asset helper — uses the original designed PNG (not the Georgia SVG stand-in).
 * - wordmark: full "Read" + book (use alone — do not also render text "Read")
 * - mark: book-only icon for compact chrome / app icons
 */
export function BrandLogo({
  variant = "wordmark",
  className,
  height = variant === "wordmark" ? 32 : 40,
  priority = false,
  alt = "Read",
}: BrandLogoProps) {
  const width = Math.round(height * ASPECT[variant]);
  const src =
    variant === "wordmark" ? "/brand/read-wordmark.png" : "/brand/read-mark.png";

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
