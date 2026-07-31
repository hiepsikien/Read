"""Compose explain cards: glossary-first, tiny context, optional LLM."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from .config import Settings
from .gemini import gemini_available, generate_gemini_text
from .glossary import aliases_from_storage

logger = logging.getLogger(__name__)

MAX_PARAGRAPH_CHARS = 500
MAX_SUMMARY_CHARS = 900
MAX_AI_CONTEXT_CHARS = 420
MAX_QUERY_CHARS = 120


def paragraph_window(content: str, paragraph_index: int | None) -> str:
    if paragraph_index is None:
        return ""
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", content) if part.strip()]
    if paragraph_index < 0 or paragraph_index >= len(paragraphs):
        return ""
    start = max(0, paragraph_index - 1)
    end = min(len(paragraphs), paragraph_index + 2)
    chunk = " ".join(
        re.sub(r"\s+", " ", paragraph.replace("\n", " ")).strip()
        for paragraph in paragraphs[start:end]
    )
    # Prefer caption text over raw figure markdown for the model.
    chunk = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", chunk)
    chunk = re.sub(r"\s+", " ", chunk).strip()
    if len(chunk) > MAX_PARAGRAPH_CHARS:
        return chunk[: MAX_PARAGRAPH_CHARS - 1].rstrip() + "…"
    return chunk


def cache_key(
    *,
    book_id: str,
    chapter_id: str,
    query: str,
    glossary_entry_id: str | None,
    paragraph_index: int | None,
    need_context: bool,
) -> str:
    payload = "|".join(
        [
            book_id,
            chapter_id,
            query.casefold().strip(),
            glossary_entry_id or "",
            "" if paragraph_index is None else str(paragraph_index),
            "1" if need_context else "0",
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


def candidate_payload(entry: Any, score: int | None = None) -> dict:
    item = {
        "id": entry.id,
        "name": entry.name,
        "episode_key": getattr(entry, "episode_key", "") or "",
        "group_label": getattr(entry, "group_label", "") or "",
    }
    if score is not None:
        item["score"] = score
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
        title = entry.name
        book_note = entry.summary or ""
        if len(book_note) > MAX_SUMMARY_CHARS:
            book_note = book_note[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"

    resolved_sources = sources or []
    if book_note and "book" not in resolved_sources:
        resolved_sources = ["book", *resolved_sources]
    if ai_context and "ai" not in resolved_sources:
        resolved_sources = [*resolved_sources, "ai"]

    if not followups:
        followups = []
        if entry is not None:
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
) -> str:
    if not need_context and book_note:
        return ""
    if not gemini_available(settings):
        return ""

    system = (
        "You help readers understand historical names in a novel. "
        "Reply in the same language as the book note / passage. "
        "Write 1-3 short sentences. "
        "If a book note is provided, do not repeat it; only add why this person matters "
        "in the given passage. No spoilers beyond the passage. No bullet lists."
    )
    user_parts = [f"Query: {query[:MAX_QUERY_CHARS]}"]
    if book_note:
        user_parts.append(f"Book note:\n{book_note[:MAX_SUMMARY_CHARS]}")
    if passage:
        user_parts.append(f"Passage:\n{passage[:MAX_PARAGRAPH_CHARS]}")
    user_parts.append("Write the brief context now.")

    try:
        text = await generate_gemini_text(
            settings=settings,
            system=system,
            user="\n\n".join(user_parts),
            temperature=0.2,
            max_output_tokens=300,
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
