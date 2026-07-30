export interface SplitChapter {
  title: string;
  content: string;
}

const CHAPTER_HEADING =
  /^(?:chapter|chương|phần|part|book|section)\s+([0-9ivxlcdm]+|[a-z])\b(?:\s*[:.\-–—]\s*(.*))?$/i;

const NUMBERED_HEADING = /^([0-9]+|[ivxlcdm]+)[.)]\s+(.+)$/i;

/**
 * Split raw document text into chapters.
 * 1) Prefer explicit chapter-like headings
 * 2) Fall back to sized chunks for long documents without headings
 */
export function splitIntoChapters(rawText: string): SplitChapter[] {
  const normalized = rawText.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const headingIndexes: { index: number; title: string }[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 120) return;

    const chapterMatch = trimmed.match(CHAPTER_HEADING);
    if (chapterMatch) {
      const suffix = chapterMatch[2]?.trim();
      const title = suffix
        ? `Chapter ${formatHeadingNumber(chapterMatch[1])} — ${suffix}`
        : `Chapter ${formatHeadingNumber(chapterMatch[1])}`;
      headingIndexes.push({ index, title });
      return;
    }

    const numbered = trimmed.match(NUMBERED_HEADING);
    if (numbered && looksLikeHeading(trimmed, lines, index)) {
      headingIndexes.push({
        index,
        title: `Chapter ${formatHeadingNumber(numbered[1])} — ${numbered[2].trim()}`,
      });
    }
  });

  if (headingIndexes.length >= 2) {
    return headingIndexes.map((heading, i) => {
      const start = heading.index + 1;
      const end = i + 1 < headingIndexes.length ? headingIndexes[i + 1].index : lines.length;
      const content = lines.slice(start, end).join("\n").trim();
      return {
        title: heading.title,
        content: content || "(Empty chapter — consider editing after split.)",
      };
    });
  }

  return chunkBySize(normalized);
}

function formatHeadingNumber(value: string) {
  return value.trim().toUpperCase();
}

function looksLikeHeading(line: string, lines: string[], index: number) {
  const prev = lines[index - 1]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  if (line.length > 80) return false;
  if (prev && prev.length > 0 && !prev.endsWith(".")) return false;
  return Boolean(next);
}

function chunkBySize(text: string): SplitChapter[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [{ title: "Chapter 1", content: text }];
  }

  const targetWords = 900;
  const chapters: SplitChapter[] = [];
  let bucket: string[] = [];
  let words = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    chapters.push({
      title: `Chapter ${chapters.length + 1}`,
      content: bucket.join("\n\n"),
    });
    bucket = [];
    words = 0;
  };

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.split(/\s+/).filter(Boolean).length;
    if (words > 0 && words + paragraphWords > targetWords) {
      flush();
    }
    bucket.push(paragraph);
    words += paragraphWords;
  }
  flush();

  return chapters.length > 0 ? chapters : [{ title: "Chapter 1", content: text }];
}
