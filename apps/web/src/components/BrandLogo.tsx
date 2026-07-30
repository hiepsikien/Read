import { cn } from "@/lib/format";

type BrandLogoProps = {
  variant?: "wordmark" | "mark";
  className?: string;
  /** CSS height for the rendered asset */
  height?: number;
  priority?: boolean;
  alt?: string;
};

const ASPECT = {
  wordmark: 320 / 96,
  mark: 1,
} as const;

/**
 * Brand asset helper.
 * - wordmark: full "Read" + book (use alone — do not also render text "Read")
 * - mark: book-only icon for compact chrome / locked states
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
    variant === "wordmark" ? "/brand/read-wordmark.svg" : "/brand/read-mark.svg";

  return (
    // SVG brand marks — <img> keeps vectors crisp without next/image SVG config.
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
