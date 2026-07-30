from __future__ import annotations

import re
from dataclasses import dataclass

TARGET_WORDS = 2000
MAX_WORDS = 3000
MIN_WORDS = 650

CHAPTER_HEADING = re.compile(
    r"^(?:chapter|chương|phần|part|book)\s+([0-9ivxlcdm]+|[a-z])\b(?:\s*[:.\-–—]\s*(.*))?$",
    re.I,
)
SECTION_LABELED = re.compile(
    r"^(?:section|mục|subsection)\s+([0-9ivxlcdm]+|[a-z0-9.]+)\b(?:\s*[:.\-–—]\s*(.*))?$",
    re.I,
)
NUMBERED_HEADING = re.compile(
    r"^([0-9]+(?:\.[0-9]+){0,3}|[ivxlcdm]+)[.)]\s+(.+)$",
    re.I,
)
SENTENCE_END = re.compile(r"[.!?…:;][\"'”’)\]]*$")
INLINE_WHITESPACE = re.compile(r"[ \t\u00a0\u200b]+")
MARKDOWN_MARKER = re.compile(r"(?<!\\)\*{1,3}")
MARKDOWN_ESCAPE = re.compile(r"\\([\\*])")


@dataclass
class SplitChapter:
    title: str
    content: str
    group_index: int


@dataclass
class HeadingHit:
    index: int
    title: str
    kind: str
    numbered_top_level: bool = False


@dataclass
class SectionBlock:
    title: str | None
    body: str


@dataclass
class LogicalChapter:
    title: str
    sections: list[SectionBlock]


def plain_text(text: str) -> str:
    """Return the readable projection used by split/count heuristics."""
    without_markers = MARKDOWN_MARKER.sub("", text)
    return MARKDOWN_ESCAPE.sub(r"\1", without_markers)


def count_words(text: str) -> int:
    return len([part for part in plain_text(text).strip().split() if part])


def is_free_preview_group(group_index: int) -> bool:
    return group_index == 1


def is_heading_line(line: str) -> bool:
    candidate = plain_text(line).strip()
    if not candidate or len(candidate) > 110:
        return False
    return bool(
        CHAPTER_HEADING.match(candidate)
        or SECTION_LABELED.match(candidate)
        or NUMBERED_HEADING.match(candidate)
        or is_title_case_heading(candidate)
    )


def normalize_document_text(
    raw_text: str, *, preserve_paragraphs: bool = False
) -> str:
    """Reflow extracted text into real paragraphs.

    PDF extraction emits visual lines — sometimes a single word per line, with
    blank lines in between. Clients that collapse whitespace (HTML) hide this,
    but native text renders every newline as a hard break, so the reflow has to
    happen before chapters are stored.
    """
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = text.split("\n")
    if preserve_paragraphs:
        return "\n\n".join(
            INLINE_WHITESPACE.sub(" ", line).strip()
            for line in raw_lines
            if line.strip()
        )

    # PDF extraction may put every visual line (or word) in its own block, so a
    # sentence end is the only reliable paragraph signal in reflow mode.
    has_blank_lines = any(not line.strip() for line in raw_lines)

    paragraphs: list[str] = []
    after_blank = True
    last_was_heading = False

    for raw_line in raw_lines:
        line = INLINE_WHITESPACE.sub(" ", raw_line).strip()
        if not line:
            after_blank = True
            continue

        heading = is_heading_line(line)
        previous_plain = plain_text(paragraphs[-1]) if paragraphs else ""
        breaks_paragraph = (
            not paragraphs
            or heading
            or last_was_heading
            or bool(
                SENTENCE_END.search(previous_plain)
                and (after_blank or not has_blank_lines)
            )
        )

        if breaks_paragraph:
            paragraphs.append(line)
        else:
            paragraphs[-1] = f"{paragraphs[-1]} {line}"

        after_blank = False
        last_was_heading = heading

    return "\n\n".join(paragraphs).strip()


def split_into_chapters(
    raw_text: str, *, preserve_paragraphs: bool = False
) -> list[SplitChapter]:
    normalized = normalize_document_text(
        raw_text, preserve_paragraphs=preserve_paragraphs
    )
    if not normalized:
        return []

    lines = normalized.split("\n")
    logical_chapters = build_logical_chapters(lines)
    units: list[SplitChapter] = []

    for chapter_index, chapter in enumerate(logical_chapters):
        packed = pack_sections_for_reading(chapter)
        for unit in packed:
            units.append(
                SplitChapter(
                    title=unit["title"],
                    content=unit["content"],
                    group_index=chapter_index + 1,
                )
            )

    if units:
        return units
    return [SplitChapter(title="Chapter 1", content=normalized, group_index=1)]


def build_logical_chapters(lines: list[str]) -> list[LogicalChapter]:
    headings = detect_headings(lines)
    chapter_hits = [h for h in headings if h.kind == "chapter"]

    if not chapter_hits:
        numbered_chapters = [
            h for h in headings if h.kind == "section" and h.numbered_top_level
        ]
        if len(numbered_chapters) >= 2:
            chapter_hits = [
                HeadingHit(
                    index=h.index,
                    kind="chapter",
                    title=f"Chapter {i + 1} — {h.title}",
                    numbered_top_level=h.numbered_top_level,
                )
                for i, h in enumerate(numbered_chapters)
            ]

    if len(chapter_hits) >= 1:
        result: list[LogicalChapter] = []
        for i, chapter in enumerate(chapter_hits):
            start = chapter.index + 1
            end = chapter_hits[i + 1].index if i + 1 < len(chapter_hits) else len(lines)
            slice_lines = lines[start:end]
            section_heads = [
                h
                for h in detect_headings(slice_lines)
                if h.kind != "chapter" and not h.numbered_top_level
            ]
            result.append(
                LogicalChapter(
                    title=chapter.title,
                    sections=slice_into_sections(slice_lines, section_heads),
                )
            )
        return result

    section_hits = [h for h in headings if h.kind == "section"]
    if len(section_hits) >= 2:
        return [
            LogicalChapter(
                title="Chapter 1",
                sections=slice_into_sections(lines, section_hits),
            )
        ]

    return [
        LogicalChapter(
            title="Chapter 1",
            sections=paragraphs_as_sections("\n".join(lines)),
        )
    ]


def detect_headings(lines: list[str]) -> list[HeadingHit]:
    hits: list[HeadingHit] = []
    for index, line in enumerate(lines):
        trimmed = plain_text(line).strip()
        if not trimmed or len(trimmed) > 110:
            continue

        chapter_match = CHAPTER_HEADING.match(trimmed)
        if chapter_match:
            if not looks_like_heading_context(trimmed, lines, index, True):
                continue
            suffix = (chapter_match.group(2) or "").strip()
            number = format_heading_number(chapter_match.group(1))
            title = f"Chapter {number} — {suffix}" if suffix else f"Chapter {number}"
            hits.append(HeadingHit(index=index, kind="chapter", title=title))
            continue

        section_labeled = SECTION_LABELED.match(trimmed)
        if section_labeled:
            if not looks_like_heading_context(trimmed, lines, index, True):
                continue
            suffix = (section_labeled.group(2) or "").strip()
            label = section_labeled.group(1)
            title = f"Section {label} — {suffix}" if suffix else f"Section {label}"
            hits.append(HeadingHit(index=index, kind="section", title=title))
            continue

        numbered = NUMBERED_HEADING.match(trimmed)
        if numbered:
            if not looks_like_heading_context(trimmed, lines, index, True):
                continue
            is_multi_level = "." in numbered.group(1)
            hits.append(
                HeadingHit(
                    index=index,
                    kind="section",
                    numbered_top_level=not is_multi_level,
                    title=numbered.group(2).strip(),
                )
            )
            continue

        if is_title_case_heading(trimmed):
            if not looks_like_heading_context(trimmed, lines, index, False):
                continue
            hits.append(
                HeadingHit(
                    index=index,
                    kind="section",
                    title=re.sub(r"^#+\s*", "", trimmed),
                )
            )

    return hits


def slice_into_sections(lines: list[str], section_headings: list[HeadingHit]) -> list[SectionBlock]:
    if not section_headings:
        return paragraphs_as_sections("\n".join(lines))

    sections: list[SectionBlock] = []
    preamble = "\n".join(lines[: section_headings[0].index]).strip()
    if preamble:
        sections.append(SectionBlock(title=None, body=preamble))

    for i, heading in enumerate(section_headings):
        start = heading.index + 1
        end = (
            section_headings[i + 1].index
            if i + 1 < len(section_headings)
            else len(lines)
        )
        body = "\n".join(lines[start:end]).strip()
        sections.append(SectionBlock(title=heading.title, body=body or ""))

    return [s for s in sections if s.title or s.body.strip()]


def paragraphs_as_sections(text: str) -> list[SectionBlock]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        trimmed = text.strip()
        return [SectionBlock(title=None, body=trimmed)] if trimmed else []
    return [SectionBlock(title=None, body=body) for body in paragraphs]


def pack_sections_for_reading(chapter: LogicalChapter) -> list[dict[str, str]]:
    sections = chapter.sections or [SectionBlock(title=None, body="")]
    packs: list[dict] = []
    current: dict = {"sections": [], "words": 0}

    def flush() -> None:
        nonlocal current
        if not current["sections"]:
            return
        packs.append(current)
        current = {"sections": [], "words": 0}

    for section in sections:
        section_words = max(1, count_words(render_section(section)))
        if section_words > MAX_WORDS:
            if current["words"] > 0:
                flush()
            for piece in split_oversized_section(section):
                packs.append(
                    {
                        "sections": [piece],
                        "words": count_words(render_section(piece)),
                    }
                )
            continue

        if current["words"] > 0 and current["words"] + section_words > TARGET_WORDS:
            flush()

        current["sections"].append(section)
        current["words"] += section_words

    flush()

    i = len(packs) - 1
    while i > 0:
        if packs[i]["words"] < MIN_WORDS and packs[i - 1]["words"] + packs[i]["words"] <= TARGET_WORDS:
            packs[i - 1]["sections"].extend(packs[i]["sections"])
            packs[i - 1]["words"] += packs[i]["words"]
            packs.pop(i)
        i -= 1

    total_parts = len(packs)
    return [
        {
            "title": title_for_pack(chapter.title, pack["sections"], index, total_parts),
            "content": "\n\n".join(render_section(s) for s in pack["sections"]).strip()
            or "(Empty segment)",
        }
        for index, pack in enumerate(packs)
    ]


def split_oversized_section(section: SectionBlock) -> list[SectionBlock]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", section.body) if p.strip()]
    if len(paragraphs) <= 1:
        return [section]

    pieces: list[SectionBlock] = []
    bucket: list[str] = []
    words = 0
    part = 1

    def flush() -> None:
        nonlocal bucket, words, part
        if not bucket:
            return
        title = None
        if section.title is not None:
            title = section.title if part == 1 else f"{section.title} (continued)"
        pieces.append(SectionBlock(title=title, body="\n\n".join(bucket)))
        bucket = []
        words = 0
        part += 1

    for paragraph in paragraphs:
        w = count_words(paragraph)
        if words > 0 and words + w > TARGET_WORDS:
            flush()
        bucket.append(paragraph)
        words += w
    flush()
    return pieces


def title_for_pack(
    chapter_title: str,
    sections: list[SectionBlock],
    index: int,
    total_parts: int,
) -> str:
    named = next((s.title for s in sections if s.title), None)
    base = f"{chapter_title} — {named}" if named else chapter_title
    if total_parts <= 1:
        return base
    return f"{base} · Part {index + 1}/{total_parts}"


def render_section(section: SectionBlock) -> str:
    if section.title:
        return f"{section.title}\n\n{section.body}".strip()
    return section.body.strip()


def format_heading_number(value: str) -> str:
    return value.strip().upper()


def looks_like_heading_context(
    line: str,
    lines: list[str],
    index: int,
    strong_pattern: bool,
) -> bool:
    prev = plain_text(lines[index - 1]).strip() if index > 0 else ""
    next_line = (
        plain_text(lines[index + 1]).strip()
        if index + 1 < len(lines)
        else ""
    )
    if len(line) > 110:
        return False

    if strong_pattern:
        if next_line == "" and index + 2 < len(lines):
            return True
        return bool(next_line) or prev == "" or index == 0

    if prev and len(prev) > 40 and not re.search(r'[.!?…"”)]$', prev) and len(prev) > len(line):
        return False
    return bool(next_line) or prev == ""


def is_title_case_heading(line: str) -> bool:
    cleaned = re.sub(r"^#+\s*", "", plain_text(line)).strip()
    if len(cleaned) < 4 or len(cleaned) > 80:
        return False
    if re.search(r"[.!?]$", cleaned):
        return False
    if "  " in cleaned:
        return False
    heading_tokens = [
        token for token in cleaned.split() if token not in {"-", "–", "—"}
    ]
    if len(heading_tokens) <= 16 and any(c.isalpha() for c in cleaned):
        # `str.upper()` covers accented scripts that an [A-Z] class would miss,
        # e.g. Vietnamese headings such as "LỜI MỞ ĐẦU".
        if cleaned == cleaned.upper():
            return True
    if re.match(r"^#{1,3}\s+\S", line):
        return True
    return False
