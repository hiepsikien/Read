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


def note_figures(raw: list | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        caption = str(item.get("caption") or "").strip()[:500]
        src = str(item.get("src") or "").strip()[:1000]
        if not caption and not src:
            continue
        row: dict[str, str] = {}
        if caption:
            row["caption"] = caption
        if src:
            row["src"] = src
        out.append(row)
        if len(out) >= 8:
            break
    return out


def figures_to_storage(raw: list | None) -> str:
    return json.dumps(note_figures(raw), ensure_ascii=False)


def figures_from_storage(raw: str | None) -> list[dict[str, str]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return note_figures(parsed)


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


def _footnote_marker_in_text(text: str, needle: str) -> bool:
    """True when [12] appears, including Seneca[12] — not a prefix of [120]."""
    stripped = needle.strip()
    if not re.fullmatch(r"\[\d+\]", stripped):
        return False
    return bool(re.search(rf"(?<!\d){re.escape(stripped)}(?!\d)", text))


NOTE_GROUPS = frozenset({"chú thích", "thuật ngữ", "bối cảnh"})
_MARKER_NUM_RE = re.compile(r"\[(\d+)\]")


def is_reader_note(entry: object) -> bool:
    """Hub/editorial notes vs character glossary (NHÂN VẬT)."""
    name = getattr(entry, "name", "") or ""
    aliases = getattr(entry, "aliases", [])
    if isinstance(aliases, str):
        aliases = aliases_from_storage(aliases)
    if any(re.fullmatch(r"\[\d+\]", str(part).strip()) for part in [name, *list(aliases)]):
        return True
    label = str(getattr(entry, "group_label", "") or "").strip().casefold()
    return label in NOTE_GROUPS


def _phrase_occurrence(folded_text: str, needle: str) -> bool:
    if len(needle) < 3:
        return False
    pattern = re.compile(rf"(?<!\w){re.escape(needle)}(?!\w)")
    return bool(pattern.search(folded_text))


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
        needles = [name, *list(aliases)]
        anchor = str(getattr(entry, "episode_title", "") or "").strip()
        if anchor and anchor not in needles:
            needles.append(anchor)
        best = 0
        if is_reader_note(entry):
            markers = [n for n in needles if re.fullmatch(r"\[\d+\]", str(n).strip())]
            if markers:
                if any(_footnote_marker_in_text(text, n) for n in markers):
                    best = 95
            else:
                for needle in needles:
                    folded_needle = normalize_lookup(str(needle))
                    if _phrase_occurrence(folded_text, folded_needle):
                        best = max(best, 80 + min(len(folded_needle), 20))
        else:
            for needle in [name, *list(aliases)]:
                if _footnote_marker_in_text(text, needle):
                    best = max(best, 95)
                    continue
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
    kept = _drop_extras_covered_by_footnotes([entry for entry, _ in hits], text)
    keep_ids = {id(entry) for entry in kept}
    hits = [item for item in hits if id(item[0]) in keep_ids]
    hits.sort(
        key=lambda item: (
            _first_hit_offset(item[0], text, folded_text),
            _footnote_number(item[0]) if _footnote_number(item[0]) is not None else 10**9,
            normalize_lookup(getattr(item[0], "name", "")),
        )
    )
    return [entry for entry, _ in hits[:limit]]


def _is_book_footnote(entry: object) -> bool:
    return any(re.fullmatch(r"\[\d+\]", part.strip()) for part in _entry_needles(entry))


def _extra_phrase(entry: object) -> str:
    phrases = [
        part
        for part in _entry_needles(entry)
        if not re.fullmatch(r"\[\d+\]", part.strip())
    ]
    phrases.sort(key=len, reverse=True)
    for phrase in phrases:
        key = normalize_lookup(phrase)
        if len(key) >= 6:
            return phrase
    return ""


def _sentence_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    start = 0
    for match in re.finditer(r"[.!?\n]+", text):
        if match.start() > start:
            spans.append((start, match.start()))
        start = match.end()
    if start < len(text):
        spans.append((start, len(text)))
    return spans


def _markers_covering_phrase(text: str, phrase: str) -> set[str]:
    found: set[str] = set()
    if not text or not phrase:
        return found
    for match in re.finditer(re.escape(phrase), text, flags=re.IGNORECASE):
        after = text[match.end() : match.end() + 32]
        before = text[max(0, match.start() - 16) : match.start()]
        for nearby in re.finditer(r"\[\d+\]", f"{before} {after}"):
            found.add(nearby.group(0))
        for start, end in _sentence_spans(text):
            if start <= match.start() < end:
                for nearby in re.finditer(r"\[\d+\]", text[start:end]):
                    found.add(nearby.group(0))
                break
    return found


def _drop_extras_covered_by_footnotes(entries: list, text: str) -> list:
    notes = [entry for entry in entries if is_reader_note(entry)]
    footnotes = [entry for entry in notes if _is_book_footnote(entry)]
    if not footnotes:
        return entries
    drop: set[int] = set()
    for extra in notes:
        if extra in footnotes:
            continue
        phrase = _extra_phrase(extra)
        if not phrase:
            continue
        key = re.sub(r"\s+", " ", phrase).casefold()
        covering = _markers_covering_phrase(text, phrase)
        for footnote in footnotes:
            markers = [part.strip() for part in _entry_needles(footnote) if re.fullmatch(r"\[\d+\]", part.strip())]
            title = re.sub(
                r"\s+",
                " ",
                f"{getattr(footnote, 'name', '')} {getattr(footnote, 'episode_title', '')}",
            ).casefold()
            if key in title:
                drop.add(id(extra))
                break
            blob = re.sub(
                r"\s+",
                " ",
                f"{getattr(footnote, 'name', '')} {getattr(footnote, 'episode_title', '')} {getattr(footnote, 'summary', '')}",
            ).casefold()
            if key in blob and any(marker in covering for marker in markers):
                drop.add(id(extra))
                break
    return [entry for entry in entries if id(entry) not in drop]


def _entry_needles(entry: object) -> list[str]:
    name = str(getattr(entry, "name", "") or "")
    aliases = getattr(entry, "aliases", [])
    if isinstance(aliases, str):
        aliases = aliases_from_storage(aliases)
    needles = [name, *list(aliases)]
    anchor = str(getattr(entry, "episode_title", "") or "").strip()
    if anchor and anchor not in needles:
        needles.append(anchor)
    return [str(part) for part in needles if str(part).strip()]


def _footnote_number(entry: object) -> int | None:
    for part in _entry_needles(entry):
        stripped = part.strip()
        if re.fullmatch(r"\[\d+\]", stripped):
            return int(stripped[1:-1])
    match = _MARKER_NUM_RE.search(str(getattr(entry, "name", "") or ""))
    return int(match.group(1)) if match else None


def _first_hit_offset(entry: object, text: str, folded_text: str) -> int:
    found: list[int] = []
    for needle in _entry_needles(entry):
        stripped = needle.strip()
        if re.fullmatch(r"\[\d+\]", stripped):
            match = re.search(rf"(?<!\d){re.escape(stripped)}(?!\d)", text)
            if match:
                found.append(match.start())
            continue
        folded_needle = normalize_lookup(stripped)
        if len(folded_needle) < 3:
            continue
        at = folded_text.find(folded_needle)
        if at >= 0:
            found.append(at)
    return min(found) if found else 10**9
