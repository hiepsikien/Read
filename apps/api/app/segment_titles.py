"""Configurable reading-segment title formatting for auto-split."""

from __future__ import annotations

import re
from typing import Literal, Sequence

TitleComponent = Literal["book", "name", "part"]
TITLE_COMPONENTS: tuple[TitleComponent, ...] = ("book", "name", "part")
DEFAULT_TITLE_COMPONENTS: list[TitleComponent] = ["name", "part"]

SuggestLanguage = Literal["en", "vi", "bilingual"]


def normalize_title_components(
    raw: Sequence[str] | None,
) -> list[TitleComponent] | None:
    """None = legacy heading-based titles. Otherwise ordered unique components."""
    if raw is None:
        return None
    seen: set[str] = set()
    out: list[TitleComponent] = []
    for item in raw:
        key = str(item or "").strip().lower()
        if key not in TITLE_COMPONENTS or key in seen:
            continue
        seen.add(key)
        out.append(key)  # type: ignore[arg-type]
    return out or list(DEFAULT_TITLE_COMPONENTS)


def normalize_suggest_language(raw: str | None) -> SuggestLanguage:
    key = (raw or "en").strip().lower()
    if key in ("vi", "vietnamese", "vn"):
        return "vi"
    if key in ("bilingual", "both", "en_vi", "en-vi"):
        return "bilingual"
    return "en"


def part_label(index: int, *, language: SuggestLanguage = "en") -> str:
    # Bilingual applies to distinctive names only; Part stays a single structural label.
    if language in ("vi", "bilingual"):
        return f"Phần {index}"
    return f"Part {index}"


def fallback_distinctive_name(
    chapter_title: str,
    section_titles: Sequence[str | None],
) -> str:
    for title in section_titles:
        cleaned = (title or "").strip()
        if cleaned:
            return cleaned
    base = (chapter_title or "").strip() or "Segment"
    if " — " in base:
        suffix = base.split(" — ", 1)[1].strip()
        if suffix:
            return suffix
    return base


def format_segment_title(
    *,
    components: Sequence[TitleComponent],
    book_title: str | None,
    distinctive_name: str | None,
    part_index: int,
    language: SuggestLanguage = "en",
    separator: str = " · ",
) -> str:
    pieces: list[str] = []
    for component in components:
        if component == "book":
            title = (book_title or "").strip()
            if title:
                pieces.append(title)
        elif component == "name":
            name = (distinctive_name or "").strip()
            if name:
                pieces.append(name)
        elif component == "part":
            pieces.append(part_label(part_index, language=language))
    if pieces:
        return separator.join(pieces)
    return part_label(part_index, language=language)


def strip_code_fence(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()
