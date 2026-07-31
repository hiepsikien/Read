export type ReaderPage = {
  startIndex: number;
  endIndex: number; // exclusive
};

/** Pack measured block heights into pages that fit in pageHeight. */
export function packBlocksIntoPages(
  heights: number[],
  pageHeight: number,
  gap = 18
): ReaderPage[] {
  if (heights.length === 0 || pageHeight <= 0) {
    return [{ startIndex: 0, endIndex: 0 }];
  }
  const pages: ReaderPage[] = [];
  let start = 0;
  let used = 0;

  for (let i = 0; i < heights.length; i += 1) {
    const h = Math.max(1, heights[i] || 1);
    const nextUsed = used === 0 ? h : used + gap + h;
    if (used > 0 && nextUsed > pageHeight) {
      pages.push({ startIndex: start, endIndex: i });
      start = i;
      used = h;
      // Oversized single block still gets its own page.
      if (h > pageHeight) {
        pages.push({ startIndex: i, endIndex: i + 1 });
        start = i + 1;
        used = 0;
      }
    } else {
      used = nextUsed;
    }
  }
  if (start < heights.length) {
    pages.push({ startIndex: start, endIndex: heights.length });
  }
  return pages.length > 0 ? pages : [{ startIndex: 0, endIndex: heights.length }];
}

export function pageIndexForParagraph(
  pages: ReaderPage[],
  paragraphIndex: number
): number {
  const idx = pages.findIndex(
    (page) => paragraphIndex >= page.startIndex && paragraphIndex < page.endIndex
  );
  return idx >= 0 ? idx : 0;
}
