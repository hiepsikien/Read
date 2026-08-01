"""Parse and match publisher character glossaries (NHÂN VẬT.docx style)."""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from docx import Document

EPISODE_RE = re.compile(r"(S\d+E\d+)", re.IGNORECASE)
ENTRY_RE = re.compile(
    r"^(?P<name>.+?)\s*(?:\((?P<meta>[^)]*)\))?\s*:\s*(?P<summary>.+)$",
    re.DOTALL,
)
YEARISH_RE = re.compile(
    r"(?:^|[\s/–—-])(?:k\.?\s*)?\d{3,4}\s*[–—-]\s*(?:k\.?\s*)?(?:\d{3,4}|\?)",
    re.IGNORECASE,
)
GROUP_LABELS = (
    "NHÂN VẬT LỊCH SỬ VIỆT NAM",
    "NHÂN VẬT LỊCH SỬ QUỐC TẾ",
    "NHÂN VẬT",
)


@dataclass(frozen=True)
class ParsedGlossaryEntry:
    episode_key: str
    episode_title: str
    group_label: str
    name: str
    aliases: list[str]
    summary: str
    sort_key: str


def normalize_lookup(value: str) -> str:
    """Casefold + strip diacritics for fuzzy Vietnamese/Latin matching.

    Vietnamese Đ/đ does not decompose under NFD, so map it to plain ``d`` so
    ASCII screenplay cues (``MAC DANG DUNG``) match glossary names with Đ.
    """
    decomposed = unicodedata.normalize("NFD", value.strip())
    without_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    collapsed = re.sub(r"\s+", " ", without_marks).casefold().strip()
    return collapsed.replace("đ", "d")


def fold_keeping_offsets(value: str) -> str:
    """Diacritic-free lowercase copy that stays index-aligned with the input.

    Scanning prose needs the original offsets so a hit can be checked for
    capitalization, which is what separates the person "Văn Phong" from the
    everyday noun "văn phong".
    """
    folded: list[str] = []
    for char in value:
        decomposed = unicodedata.normalize("NFD", char)
        base = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
        folded_char = (base[:1] or char).casefold()
        folded.append("d" if folded_char == "đ" else folded_char)
    return "".join(folded)


def aliases_to_storage(aliases: list[str]) -> str:
    return json.dumps(aliases, ensure_ascii=False)


def aliases_from_storage(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return [part.strip() for part in raw.split("\n") if part.strip()]
    if isinstance(data, list):
        return [str(item).strip() for item in data if str(item).strip()]
    return []


def _split_name_aliases(name_raw: str, meta: str | None) -> tuple[str, list[str]]:
    aliases: list[str] = []
    name = re.sub(r"\s+", " ", name_raw).strip(" .")

    # Dual entries: "A & B"
    if " & " in name:
        parts = [part.strip() for part in name.split(" & ") if part.strip()]
        if parts:
            name = parts[0]
            aliases.extend(parts[1:])

    # Alternate romanization inside years paren: "Hugo Grotius (Huig de Groot - 1583 – 1645)"
    if meta:
        meta_clean = meta.strip()
        if not YEARISH_RE.search(meta_clean):
            aliases.append(meta_clean)
        else:
            # Take left side before year-ish span when it looks like an alt name.
            before = YEARISH_RE.split(meta_clean, maxsplit=1)[0].strip(" -–—/")
            if before and len(before) >= 3 and not before.isdigit():
                aliases.append(before)

    # "Tokugawa Ieyasu (Đức Xuyên Gia Khang - 1543 – 1616)" already handled via meta.
    # Also peel "Name - Role" display forms into an alias without the role suffix.
    if " - " in name:
        left, right = name.split(" - ", 1)
        if left.strip() and right.strip():
            aliases.append(name)
            name = left.strip()

    # Dedupe while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for alias in aliases:
        key = normalize_lookup(alias)
        if not key or key == normalize_lookup(name) or key in seen:
            continue
        seen.add(key)
        unique.append(alias)
    return name, unique


def parse_glossary_paragraphs(paragraphs: list[str]) -> list[ParsedGlossaryEntry]:
    episode_key = ""
    episode_title = ""
    group_label = ""
    entries: list[ParsedGlossaryEntry] = []

    for raw in paragraphs:
        text = raw.strip()
        if not text:
            continue

        upper = unicodedata.normalize("NFC", text).upper()
        if upper == "NHÂN VẬT":
            continue
        if upper in {label.upper() for label in GROUP_LABELS if label.upper() != "NHÂN VẬT"}:
            group_label = text
            continue

        episode_match = EPISODE_RE.match(text)
        if episode_match and not re.search(r"\([^)]*\):\s*\S", text):
            # Episode headings look like "S1E1: TITLE" — not "Name (years): bio".
            episode_key = episode_match.group(1).upper()
            rest = text[episode_match.end() :].lstrip(" :-–—")
            episode_title = rest.strip() or episode_key
            group_label = ""
            continue

        entry_match = ENTRY_RE.match(text)
        if not entry_match:
            continue

        name_raw = entry_match.group("name").strip()
        meta = entry_match.group("meta")
        summary = re.sub(r"\s+", " ", entry_match.group("summary")).strip()
        if not name_raw or not summary:
            continue
        if EPISODE_RE.match(name_raw):
            continue

        name, aliases = _split_name_aliases(name_raw, meta)
        if meta and YEARISH_RE.search(meta):
            years = meta.strip()
            if years and not summary.startswith("("):
                summary = f"({years}) {summary}"

        entries.append(
            ParsedGlossaryEntry(
                episode_key=episode_key,
                episode_title=episode_title,
                group_label=group_label,
                name=name,
                aliases=aliases,
                summary=summary,
                sort_key=normalize_lookup(name),
            )
        )

    return entries


def parse_glossary_docx(path: Path | str) -> list[ParsedGlossaryEntry]:
    document = Document(str(path))
    paragraphs = [paragraph.text for paragraph in document.paragraphs]
    return parse_glossary_paragraphs(paragraphs)


def infer_episode_key(*texts: str) -> str:
    for text in texts:
        if not text:
            continue
        match = EPISODE_RE.search(text.upper())
        if match:
            return match.group(1).upper()
    return ""


def entry_match_score(query: str, name: str, aliases: list[str]) -> int:
    """Higher is better. 0 = no match."""
    q = normalize_lookup(query)
    if not q or len(q) < 2:
        return 0

    candidates = [name, *aliases]
    best = 0
    for candidate in candidates:
        c = normalize_lookup(candidate)
        if not c:
            continue
        if q == c:
            best = max(best, 100)
        elif c.startswith(q) or q.startswith(c):
            best = max(best, 90)
        elif q in c or c in q:
            best = max(best, 80)
        else:
            # Token overlap for multi-word historical names
            q_tokens = [t for t in q.split(" ") if len(t) > 2]
            c_tokens = [t for t in c.split(" ") if len(t) > 2]
            if q_tokens and c_tokens:
                overlap = len(set(q_tokens) & set(c_tokens))
                if overlap and overlap == len(q_tokens):
                    best = max(best, 70)
                elif overlap >= 2:
                    best = max(best, 60)
                elif overlap == 1 and len(q_tokens) == 1:
                    best = max(best, 50)
    return best


def find_glossary_matches(
    entries: list,
    query: str,
    *,
    episode_key: str = "",
    limit: int = 5,
) -> list[tuple[object, int]]:
    """Rank glossary ORM rows or ParsedGlossaryEntry objects by query."""
    scored: list[tuple[object, int]] = []
    for entry in entries:
        name = getattr(entry, "name")
        aliases = getattr(entry, "aliases")
        if isinstance(aliases, str):
            aliases = aliases_from_storage(aliases)
        score = entry_match_score(query, name, list(aliases))
        if score <= 0:
            continue
        entry_episode = getattr(entry, "episode_key", "") or ""
        if episode_key and entry_episode and entry_episode.upper() == episode_key.upper():
            score += 15
        scored.append((entry, score))
    scored.sort(key=lambda item: (-item[1], normalize_lookup(getattr(item[0], "name", ""))))
    return scored[:limit]


def _proper_noun_occurrence(text: str, folded_text: str, needle: str) -> bool:
    """True when the needle appears as a capitalized whole-word run."""
    pattern = re.compile(rf"(?<!\w){re.escape(needle)}(?!\w)")
    for match in pattern.finditer(folded_text):
        original = text[match.start() : match.end()]
        first_letter = next((ch for ch in original if ch.isalpha()), "")
        if first_letter.isupper():
            return True
    return False


def find_names_in_text(entries: list, text: str, *, episode_key: str = "", limit: int = 8) -> list:
    """Find glossary entries whose name/alias appears in a paragraph."""
    if not text.strip():
        return []
    folded_text = fold_keeping_offsets(text)

    hits: list[tuple[object, int]] = []
    for entry in entries:
        name = getattr(entry, "name")
        aliases = getattr(entry, "aliases")
        if isinstance(aliases, str):
            aliases = aliases_from_storage(aliases)
        best = 0
        for needle in [name, *list(aliases)]:
            folded_needle = normalize_lookup(needle)
            if len(folded_needle) < 3:
                continue
            if _proper_noun_occurrence(text, folded_text, folded_needle):
                best = max(best, 80 + min(len(folded_needle), 20))
        if best <= 0:
            continue
        entry_episode = getattr(entry, "episode_key", "") or ""
        if episode_key and entry_episode and entry_episode.upper() == episode_key.upper():
            best += 15
        hits.append((entry, best))
    hits.sort(key=lambda item: (-item[1], normalize_lookup(getattr(item[0], "name", ""))))
    return [entry for entry, _ in hits[:limit]]
