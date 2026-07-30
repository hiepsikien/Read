export interface SplitChapter {
  title: string;
  content: string;
  /** 1-based logical chapter index (for free preview of whole chapter 1). */
  groupIndex: number;
}

type HeadingKind = "chapter" | "section";

interface HeadingHit {
  index: number;
  title: string;
  kind: HeadingKind;
  numberedTopLevel?: boolean;
}

interface SectionBlock {
  title: string | null;
  body: string;
}

interface LogicalChapter {
  title: string;
  sections: SectionBlock[];
}

const TARGET_WORDS = 850;
const MAX_WORDS = 1300;
const MIN_WORDS = 280;

const CHAPTER_HEADING =
  /^(?:chapter|chương|phần|part|book)\s+([0-9ivxlcdm]+|[a-z])\b(?:\s*[:.\-–—]\s*(.*))?$/i;

const SECTION_LABELED =
  /^(?:section|mục|subsection)\s+([0-9ivxlcdm]+|[a-z0-9.]+)\b(?:\s*[:.\-–—]\s*(.*))?$/i;

const NUMBERED_HEADING = /^([0-9]+(?:\.[0-9]+){0,3}|[ivxlcdm]+)[.)]\s+(.+)$/i;

/**
 * Smart split for in-app reading:
 * 1) Detect existing chapters
 * 2) Detect sections (mục) inside each chapter
 * 3) Pack sections into comfortable reading segments
 * 4) Never split a section across two reading units
 */
export function splitIntoChapters(rawText: string): SplitChapter[] {
  const normalized = rawText.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const logicalChapters = buildLogicalChapters(lines);

  const units: SplitChapter[] = [];

  logicalChapters.forEach((chapter, chapterIndex) => {
    const packed = packSectionsForReading(chapter);
    packed.forEach((unit) => {
      units.push({
        title: unit.title,
        content: unit.content,
        groupIndex: chapterIndex + 1,
      });
    });
  });

  return units.length > 0
    ? units
    : [{ title: "Chapter 1", content: normalized, groupIndex: 1 }];
}

function buildLogicalChapters(lines: string[]): LogicalChapter[] {
  const headings = detectHeadings(lines);
  let chapterHits = headings.filter((h) => h.kind === "chapter");

  // Books that use "1. Title" / "2. Title" without the word Chapter.
  if (chapterHits.length === 0) {
    const numberedChapters = headings.filter(
      (h) => h.kind === "section" && h.numberedTopLevel
    );
    if (numberedChapters.length >= 2) {
      chapterHits = numberedChapters.map((h, i) => ({
        ...h,
        kind: "chapter" as const,
        title: `Chapter ${i + 1} — ${h.title}`,
      }));
    }
  }

  if (chapterHits.length >= 1) {
    return chapterHits.map((chapter, i) => {
      const start = chapter.index + 1;
      const end = i + 1 < chapterHits.length ? chapterHits[i + 1].index : lines.length;
      const slice = lines.slice(start, end);
      const sectionHeads = detectHeadings(slice).filter((h) => {
        if (h.kind === "chapter") return false;
        if (h.numberedTopLevel) return false;
        return true;
      });
      return {
        title: chapter.title,
        sections: sliceIntoSections(slice, sectionHeads),
      };
    });
  }

  // No explicit chapters — treat the whole document as one logical chapter,
  // still respecting section boundaries when packing reading units.
  const sectionHits = headings.filter((h) => h.kind === "section");
  if (sectionHits.length >= 2) {
    return [
      {
        title: "Chapter 1",
        sections: sliceIntoSections(lines, sectionHits),
      },
    ];
  }

  return [
    {
      title: "Chapter 1",
      sections: paragraphsAsSections(lines.join("\n")),
    },
  ];
}

function detectHeadings(lines: string[]): HeadingHit[] {
  const hits: HeadingHit[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 110) return;

    const chapterMatch = trimmed.match(CHAPTER_HEADING);
    if (chapterMatch) {
      if (!looksLikeHeadingContext(trimmed, lines, index, true)) return;
      const suffix = chapterMatch[2]?.trim();
      hits.push({
        index,
        kind: "chapter",
        title: suffix
          ? `Chapter ${formatHeadingNumber(chapterMatch[1])} — ${suffix}`
          : `Chapter ${formatHeadingNumber(chapterMatch[1])}`,
      });
      return;
    }

    const sectionLabeled = trimmed.match(SECTION_LABELED);
    if (sectionLabeled) {
      if (!looksLikeHeadingContext(trimmed, lines, index, true)) return;
      const suffix = sectionLabeled[2]?.trim();
      hits.push({
        index,
        kind: "section",
        title: suffix
          ? `Section ${sectionLabeled[1]} — ${suffix}`
          : `Section ${sectionLabeled[1]}`,
      });
      return;
    }

    const numbered = trimmed.match(NUMBERED_HEADING);
    if (numbered) {
      if (!looksLikeHeadingContext(trimmed, lines, index, true)) return;
      const isMultiLevel = numbered[1].includes(".");
      hits.push({
        index,
        kind: "section",
        numberedTopLevel: !isMultiLevel,
        title: numbered[2].trim(),
      });
      return;
    }

    if (isTitleCaseHeading(trimmed)) {
      if (!looksLikeHeadingContext(trimmed, lines, index, false)) return;
      hits.push({
        index,
        kind: "section",
        title: trimmed.replace(/^#+\s*/, ""),
      });
    }
  });

  return hits;
}

function sliceIntoSections(lines: string[], sectionHeadings: HeadingHit[]): SectionBlock[] {
  if (sectionHeadings.length === 0) {
    return paragraphsAsSections(lines.join("\n"));
  }

  const sections: SectionBlock[] = [];
  const preamble = lines.slice(0, sectionHeadings[0].index).join("\n").trim();
  if (preamble) {
    sections.push({ title: null, body: preamble });
  }

  sectionHeadings.forEach((heading, i) => {
    const start = heading.index + 1;
    const end = i + 1 < sectionHeadings.length ? sectionHeadings[i + 1].index : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    sections.push({
      title: heading.title,
      body: body || "",
    });
  });

  return sections.filter((s) => s.title || s.body.trim());
}

function paragraphsAsSections(text: string): SectionBlock[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    const trimmed = text.trim();
    return trimmed ? [{ title: null, body: trimmed }] : [];
  }

  // Keep each paragraph atomic so we never tear a paragraph across units.
  return paragraphs.map((body) => ({ title: null, body }));
}

function packSectionsForReading(chapter: LogicalChapter): Array<{ title: string; content: string }> {
  const sections = chapter.sections.length
    ? chapter.sections
    : [{ title: null, body: "" }];

  type Pack = { sections: SectionBlock[]; words: number };
  const packs: Pack[] = [];
  let current: Pack = { sections: [], words: 0 };

  const flush = () => {
    if (current.sections.length === 0) return;
    packs.push(current);
    current = { sections: [], words: 0 };
  };

  for (const section of sections) {
    const sectionWords = Math.max(1, countWords(renderSection(section)));

    // Oversized single section: split by paragraphs, never mid-paragraph.
    if (sectionWords > MAX_WORDS) {
      if (current.words > 0) flush();
      const pieces = splitOversizedSection(section);
      for (const piece of pieces) {
        packs.push({ sections: [piece], words: countWords(renderSection(piece)) });
      }
      continue;
    }

    if (current.words > 0 && current.words + sectionWords > TARGET_WORDS) {
      flush();
    }

    current.sections.push(section);
    current.words += sectionWords;
  }
  flush();

  // Absorb tiny trailing packs into the previous pack when possible,
  // but never re-merge past the comfortable reading target.
  for (let i = packs.length - 1; i > 0; i -= 1) {
    if (packs[i].words >= MIN_WORDS) continue;
    if (packs[i - 1].words + packs[i].words > TARGET_WORDS) continue;
    packs[i - 1].sections.push(...packs[i].sections);
    packs[i - 1].words += packs[i].words;
    packs.splice(i, 1);
  }

  const totalParts = packs.length;
  return packs.map((pack, index) => ({
    title: titleForPack(chapter.title, pack.sections, index, totalParts),
    content: pack.sections.map(renderSection).join("\n\n").trim() || "(Empty segment)",
  }));
}

function splitOversizedSection(section: SectionBlock): SectionBlock[] {
  const paragraphs = section.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return [section];
  }

  const pieces: SectionBlock[] = [];
  let bucket: string[] = [];
  let words = 0;
  let part = 1;

  const flush = () => {
    if (bucket.length === 0) return;
    const title =
      section.title == null
        ? null
        : part === 1
          ? section.title
          : `${section.title} (continued)`;
    pieces.push({ title, body: bucket.join("\n\n") });
    bucket = [];
    words = 0;
    part += 1;
  };

  for (const paragraph of paragraphs) {
    const w = countWords(paragraph);
    if (words > 0 && words + w > TARGET_WORDS) flush();
    bucket.push(paragraph);
    words += w;
  }
  flush();

  return pieces;
}

function titleForPack(
  chapterTitle: string,
  sections: SectionBlock[],
  index: number,
  totalParts: number
) {
  const named = sections.find((s) => s.title)?.title;
  const base = named ? `${chapterTitle} — ${named}` : chapterTitle;
  if (totalParts <= 1) return base;
  return `${base} · Part ${index + 1}/${totalParts}`;
}

function renderSection(section: SectionBlock) {
  if (section.title) {
    return `${section.title}\n\n${section.body}`.trim();
  }
  return section.body.trim();
}

function formatHeadingNumber(value: string) {
  return value.trim().toUpperCase();
}

function looksLikeHeadingContext(
  line: string,
  lines: string[],
  index: number,
  strongPattern: boolean
) {
  const prev = lines[index - 1]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  if (line.length > 110) return false;

  // Strong patterns (Chapter / Section / 1. Title) may follow body text
  // that has no trailing punctuation — still treat them as headings.
  if (strongPattern) {
    if (next === "" && index + 2 < lines.length) return true;
    return Boolean(next) || prev === "" || index === 0;
  }

  if (prev && prev.length > 40 && !/[.!?…"”)]$/.test(prev) && prev.length > line.length) {
    return false;
  }
  return Boolean(next) || prev === "";
}

function isTitleCaseHeading(line: string) {
  const cleaned = line.replace(/^#+\s*/, "").trim();
  if (cleaned.length < 4 || cleaned.length > 80) return false;
  if (/[.!?]$/.test(cleaned)) return false;
  if (cleaned.includes("  ")) return false;
  // ALL CAPS short headings
  if (/^[A-Z0-9][A-Z0-9\s,'’\-–—:]+$/.test(cleaned) && cleaned.split(/\s+/).length <= 8) {
    return true;
  }
  // Markdown-style
  if (/^#{1,3}\s+\S/.test(line)) return true;
  return false;
}

export function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Words belonging to logical chapter group 1 (free preview). */
export function isFreePreviewGroup(groupIndex: number) {
  return groupIndex === 1;
}
