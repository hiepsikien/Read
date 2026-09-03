"""Compose explain cards: glossary-first, tiny context, optional LLM."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from .config import Settings
from .gemini import gemini_available, generate_gemini_text
from .glossary import aliases_from_storage, normalize_lookup

logger = logging.getLogger(__name__)

MAX_PARAGRAPH_CHARS = 500
MAX_SUMMARY_CHARS = 900
MAX_AI_CONTEXT_CHARS = 420
MAX_QUERY_CHARS = 120


def normalize_catalog_language(raw: str | None, default: str = "en") -> str:
    """Store Hub ``book.language`` as a short tag; do not collapse to en|vi."""
    value = (raw or "").strip().lower().replace("_", "-")
    if not value:
        value = (default or "en").strip().lower().replace("_", "-")
    return value[:16]


def normalize_explain_language(raw: str | None, default: str = "en") -> str:
    value = (raw or "").strip().lower().replace("_", "-")
    if value.startswith("vi"):
        return "vi"
    if value.startswith("en"):
        return "en"
    fallback = (default or "en").strip().lower().replace("_", "-")
    return "vi" if fallback.startswith("vi") else "en"


def book_explain_language(book: Any) -> str:
    return normalize_explain_language(
        str(getattr(book, "language", "") or "") or str(getattr(book, "source_language", "") or "")
    )


def explain_language_rule(language: str) -> str:
    if language == "vi":
        return (
            "Reply in Vietnamese. Keep Vietnamese even if the passage quotes "
            "English, German, Italian, Latin, or another language."
        )
    return (
        "Reply in English. Keep English even if the passage quotes "
        "German, Italian, Latin, or another language."
    )


def resolve_explain_passage(
    *,
    host_text: str = "",
    content: str = "",
    paragraph_index: int | None = None,
    paragraph_explain: bool = False,
) -> str:
    host = re.sub(r"\s+", " ", (host_text or "").strip())
    if host:
        if len(host) > MAX_SUMMARY_CHARS:
            return host[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"
        return host
    if paragraph_explain:
        return single_paragraph(content, paragraph_index)
    return paragraph_window(content, paragraph_index)


def _plain_paragraphs(content: str) -> list[str]:
    return [
        re.sub(r"\s+", " ", part.replace("\n", " ")).strip()
        for part in re.split(r"\n\s*\n", content)
        if part.strip()
    ]


def _strip_figure_markdown(text: str) -> str:
    return re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)


def paragraph_card_title(paragraph: str, *, limit: int = 72) -> str:
    text = _strip_figure_markdown(re.sub(r"\s+", " ", paragraph).strip())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].strip()
    return f"{cut or text[:limit]}…"


def single_paragraph(content: str, paragraph_index: int | None) -> str:
    if paragraph_index is None:
        return ""
    paragraphs = _plain_paragraphs(content)
    if paragraph_index < 0 or paragraph_index >= len(paragraphs):
        return ""
    chunk = _strip_figure_markdown(paragraphs[paragraph_index]).strip()
    chunk = re.sub(r"\s+", " ", chunk)
    if len(chunk) > MAX_SUMMARY_CHARS:
        return chunk[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"
    return chunk


def paragraph_window(content: str, paragraph_index: int | None) -> str:
    if paragraph_index is None:
        return ""
    paragraphs = _plain_paragraphs(content)
    if paragraph_index < 0 or paragraph_index >= len(paragraphs):
        return ""
    start = max(0, paragraph_index - 1)
    end = min(len(paragraphs), paragraph_index + 2)
    chunk = " ".join(paragraphs[start:end])
    # Prefer caption text over raw figure markdown for the model.
    chunk = _strip_figure_markdown(chunk)
    chunk = re.sub(r"\s+", " ", chunk).strip()
    if len(chunk) > MAX_PARAGRAPH_CHARS:
        return chunk[: MAX_PARAGRAPH_CHARS - 1].rstrip() + "…"
    return chunk


def entry_cache_key(*, book_id: str, glossary_entry_id: str, language: str = "") -> str:
    """Stable card cache for one book note — reused across chapters."""
    payload = f"{book_id}|entry|{glossary_entry_id}|{language}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def cache_key(
    *,
    book_id: str,
    chapter_id: str,
    query: str,
    glossary_entry_id: str | None,
    paragraph_index: int | None,
    need_context: bool,
    language: str = "",
) -> str:
    payload = "|".join(
        [
            book_id,
            chapter_id,
            query.casefold().strip(),
            glossary_entry_id or "",
            "" if paragraph_index is None else str(paragraph_index),
            "1" if need_context else "0",
            language,
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def entry_payload(entry: Any) -> dict:
    aliases = entry.aliases
    if isinstance(aliases, str):
        aliases = aliases_from_storage(aliases)
    summary = entry.summary or ""
    if len(summary) > MAX_SUMMARY_CHARS:
        summary = summary[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"
    return {
        "id": entry.id,
        "name": entry.name,
        "aliases": aliases,
        "summary": summary,
        "episode_key": entry.episode_key or "",
        "group_label": entry.group_label or "",
    }


def note_card_title(entry: Any) -> str:
    """Prefer the in-text hook when Hub reuses a section heading as the note name."""
    name = str(getattr(entry, "name", "") or "").strip()
    group = str(getattr(entry, "group_label", "") or "").strip().casefold()
    anchor = str(getattr(entry, "episode_title", "") or "").strip()
    aliases = getattr(entry, "aliases", [])
    if isinstance(aliases, str):
        aliases = aliases_from_storage(aliases)
    aliases = [str(part).strip() for part in aliases if str(part).strip()]
    section = group.startswith("bối cảnh") or name.casefold().startswith("bối cảnh")
    if not section:
        return name
    for candidate in [anchor, *aliases]:
        if (
            candidate
            and not re.fullmatch(r"\[\d+\]", candidate)
            and normalize_lookup(candidate) != normalize_lookup(name)
        ):
            return candidate[:200]
    return name


def candidate_payload(entry: Any, score: int | None = None, *, include_summary: bool = False) -> dict:
    item = {
        "id": entry.id,
        "name": note_card_title(entry) or entry.name,
        "episode_key": getattr(entry, "episode_key", "") or "",
        "group_label": getattr(entry, "group_label", "") or "",
    }
    if score is not None:
        item["score"] = score
    if include_summary:
        summary = str(getattr(entry, "summary", "") or "")
        if len(summary) > MAX_SUMMARY_CHARS:
            summary = summary[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"
        item["summary"] = summary
    return item


def compose_card(
    *,
    query: str,
    entry: Any | None,
    ai_context: str = "",
    sources: list[str] | None = None,
    followups: list[str] | None = None,
) -> dict:
    book_note = ""
    title = query.strip()
    if entry is not None:
        title = note_card_title(entry) or entry.name
        # Keep the full editorial note for the reader; only the model prompt is capped.
        book_note = entry.summary or ""

    resolved_sources = sources or []
    if book_note and "book" not in resolved_sources:
        resolved_sources = ["book", *resolved_sources]
    if ai_context and "ai" not in resolved_sources:
        resolved_sources = [*resolved_sources, "ai"]

    if not followups:
        followups = []
        group = str(getattr(entry, "group_label", "") or "").strip().casefold() if entry is not None else ""
        is_editorial_note = group in {"chú thích", "thuật ngữ", "bối cảnh"}
        if entry is not None and not is_editorial_note:
            followups.append(f"Why does {entry.name} matter in this passage?")
            if entry.episode_key:
                followups.append(f"Who else is related to {entry.name} in {entry.episode_key}?")

    return {
        "title": title,
        "book_note": book_note,
        "ai_context": ai_context.strip(),
        "sources": resolved_sources,
        "followups": followups[:3],
        "glossary_entry": entry_payload(entry) if entry is not None else None,
    }


async def maybe_generate_ai_context(
    *,
    settings: Settings,
    query: str,
    book_note: str,
    passage: str,
    need_context: bool,
    editorial: bool = False,
    passage_explain: bool = False,
    language: str = "en",
) -> str:
    if not need_context:
        return ""
    if not gemini_available(settings):
        return ""

    lang = normalize_explain_language(language)
    lang_rule = explain_language_rule(lang)
    if passage_explain:
        system = (
            "You help readers understand a passage of a book. "
            f"{lang_rule} "
            "Write 2-4 short sentences that explain the meaning of this paragraph — "
            "the argument or idea, not a word-for-word paraphrase. "
            "No spoilers beyond the passage. No bullet lists."
        )
    elif editorial:
        system = (
            "You help readers understand a scholarly footnote. "
            f"{lang_rule} "
            "Use the host paragraph together with the book note. "
            "Write 1-3 short sentences that add context the note itself does not repeat. "
            "No bullet lists."
        )
    else:
        system = (
            "You help readers understand historical names in a novel. "
            f"{lang_rule} "
            "Write 1-3 short sentences. "
            "If a book note is provided, do not repeat it; only add why this person matters "
            "in the given passage. No spoilers beyond the passage. No bullet lists."
        )
    user_parts = [f"Query: {query[:MAX_QUERY_CHARS]}"]
    if passage:
        cap = MAX_SUMMARY_CHARS if passage_explain or editorial else MAX_PARAGRAPH_CHARS
        user_parts.append(f"Host paragraph:\n{passage[:cap]}")
    if book_note:
        user_parts.append(f"Book note:\n{book_note[:MAX_SUMMARY_CHARS]}")
    written = "Vietnamese" if lang == "vi" else "English"
    user_parts.append(
        f"Write the brief explanation in {written} now."
        if passage_explain
        else f"Write the brief context in {written} now."
    )

    try:
        text = await generate_gemini_text(
            settings=settings,
            system=system,
            user="\n\n".join(user_parts),
            temperature=0.2,
            max_output_tokens=400 if passage_explain else 300,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Gemini explain call failed")
        return ""

    if len(text) > MAX_AI_CONTEXT_CHARS:
        text = text[: MAX_AI_CONTEXT_CHARS - 1].rstrip() + "…"
    return text


def dumps_card(card: dict) -> str:
    return json.dumps(card, ensure_ascii=False)


def loads_card(raw: str) -> dict:
    return json.loads(raw)
