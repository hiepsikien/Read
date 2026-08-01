"""Detect which glossary characters (and unmatched cues) actually speak in chapters."""

from __future__ import annotations

from dataclasses import dataclass

from .glossary import aliases_from_storage, normalize_lookup
from . import tts


@dataclass(frozen=True)
class SpeakerAppearance:
    cue: str
    key: str
    line_count: int
    first_chapter_id: str
    first_chapter_title: str
    first_chapter_position: int


def extract_speakers_from_content(content: str) -> list[str]:
    """Ordered unique speaker display names from screenplay dialogue paragraphs."""
    import re

    speakers: list[str] = []
    seen: set[str] = set()
    paragraphs = [
        collapsed
        for paragraph in re.split(r"\n\s*\n", content)
        if (collapsed := re.sub(r"\s*\n\s*", " ", paragraph).strip())
    ]
    for paragraph in paragraphs:
        parsed = tts._parse_screenplay_paragraph(paragraph)
        if not parsed:
            continue
        speaker, _role, _direction, _dialogue = parsed
        if not speaker:
            continue
        key = normalize_lookup(speaker)
        if not key or key in seen:
            continue
        seen.add(key)
        speakers.append(speaker)
    return speakers


def collect_speaking_appearances(chapters: list) -> list[SpeakerAppearance]:
    """First-appearance order across chapters, with line counts."""
    import re

    ordered: list[SpeakerAppearance] = []
    index: dict[str, int] = {}

    for chapter in sorted(chapters, key=lambda c: getattr(c, "position", 0) or 0):
        content = getattr(chapter, "content", "") or ""
        paragraphs = [
            collapsed
            for paragraph in re.split(r"\n\s*\n", content)
            if (collapsed := re.sub(r"\s*\n\s*", " ", paragraph).strip())
        ]
        for paragraph in paragraphs:
            parsed = tts._parse_screenplay_paragraph(paragraph)
            if not parsed:
                continue
            speaker, _role, _direction, _dialogue = parsed
            if not speaker:
                continue
            key = normalize_lookup(speaker)
            if not key:
                continue
            if key not in index:
                index[key] = len(ordered)
                ordered.append(
                    SpeakerAppearance(
                        cue=speaker,
                        key=key,
                        line_count=1,
                        first_chapter_id=getattr(chapter, "id", "") or "",
                        first_chapter_title=getattr(chapter, "title", "") or "",
                        first_chapter_position=int(getattr(chapter, "position", 0) or 0),
                    )
                )
            else:
                prev = ordered[index[key]]
                ordered[index[key]] = SpeakerAppearance(
                    cue=prev.cue,
                    key=prev.key,
                    line_count=prev.line_count + 1,
                    first_chapter_id=prev.first_chapter_id,
                    first_chapter_title=prev.first_chapter_title,
                    first_chapter_position=prev.first_chapter_position,
                )
    return ordered


def match_speaker_to_glossary(entries: list, speaker_cue: str) -> object | None:
    """Best glossary row for a screenplay cue, or None if unmatched."""
    cue_key = normalize_lookup(speaker_cue)
    if not cue_key:
        return None

    best = None
    best_score = 0
    for entry in entries:
        name = getattr(entry, "name", "") or ""
        aliases = getattr(entry, "aliases", [])
        if isinstance(aliases, str):
            aliases = aliases_from_storage(aliases)
        candidates = [name, *list(aliases)]
        for candidate in candidates:
            cand_key = normalize_lookup(candidate)
            if not cand_key:
                continue
            if cand_key == cue_key:
                return entry
            # Cue is a suffix/prefix of the glossary name (VASCO vs Vasco da Gama).
            if cue_key in cand_key or cand_key in cue_key:
                score = min(len(cue_key), len(cand_key))
                if score > best_score:
                    best_score = score
                    best = entry
    # Require a reasonably long partial match to avoid false hits.
    if best is not None and best_score >= 4:
        return best
    return None


def speaking_cast_plan(chapters: list, glossary_entries: list) -> dict:
    """Build speaking-only cast plan with matched + unmatched speakers."""
    appearances = collect_speaking_appearances(chapters)

    # Dedupe glossary by primary name for matching display rows.
    glossary_by_key: dict[str, object] = {}
    for entry in glossary_entries:
        key = normalize_lookup(getattr(entry, "name", "") or "")
        if key and key not in glossary_by_key:
            glossary_by_key[key] = entry

    matched_ids: set[str] = set()
    speaking_entries: list[dict] = []
    unmatched: list[dict] = []

    for appearance in appearances:
        entry = match_speaker_to_glossary(glossary_entries, appearance.cue)
        if entry is not None:
            entry_id = getattr(entry, "id", "")
            if entry_id in matched_ids:
                # Same glossary person spoken under another cue — bump lines on first.
                for item in speaking_entries:
                    if item.get("id") == entry_id:
                        item["line_count"] = int(item["line_count"]) + appearance.line_count
                        break
                continue
            matched_ids.add(entry_id)
            speaking_entries.append(
                {
                    "glossary_entry": entry,
                    "speaker_cue": appearance.cue,
                    "speaker_key": appearance.key,
                    "matched": True,
                    "line_count": appearance.line_count,
                    "first_chapter_id": appearance.first_chapter_id,
                    "first_chapter_title": appearance.first_chapter_title,
                    "first_chapter_position": appearance.first_chapter_position,
                }
            )
        else:
            unmatched.append(
                {
                    "glossary_entry": None,
                    "speaker_cue": appearance.cue,
                    "speaker_key": appearance.key,
                    "matched": False,
                    "line_count": appearance.line_count,
                    "first_chapter_id": appearance.first_chapter_id,
                    "first_chapter_title": appearance.first_chapter_title,
                    "first_chapter_position": appearance.first_chapter_position,
                }
            )

    glossary_only = [
        entry
        for key, entry in glossary_by_key.items()
        if getattr(entry, "id", "") not in matched_ids
    ]
    return {
        "speaking": speaking_entries,
        "unmatched": unmatched,
        "glossary_only": glossary_only,
        "speaking_count": len(speaking_entries) + len(unmatched),
        "glossary_count": len(glossary_by_key),
        "unmatched_count": len(unmatched),
    }
