"""Character glossary upload + explain (glossary-first, token-efficient)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from nanoid import generate
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import get_current_user_optional, require_publisher
from ..config import get_settings
from ..db import get_db
from ..explain import (
    cache_key,
    candidate_payload,
    compose_card,
    dumps_card,
    entry_cache_key,
    loads_card,
    maybe_generate_ai_context,
    paragraph_card_title,
    paragraph_window,
    single_paragraph,
)
from ..glossary import (
    aliases_from_storage,
    aliases_to_storage,
    find_glossary_matches,
    find_names_in_text,
    infer_episode_key,
    is_reader_note,
    parse_glossary_docx,
)
from ..models import Book, Chapter, ExplainCache, GlossaryEntry, User
from ..tts_settings import get_active_tts
from ..voice_cast import ensure_entries_cast

router = APIRouter(prefix="/api/books", tags=["glossary"])

DOCX_EXT = ".docx"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
EDITABLE_STATUSES = {"draft", "rejected"}


class ExplainBody(BaseModel):
    query: str | None = None
    paragraph_index: int | None = None
    entry_id: str | None = None
    need_context: bool = False


def _assert_editable(book: Book) -> None:
    if book.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Book is {book.status} and cannot be edited.",
        )


def _can_manage_book(book: Book, user: User | None) -> bool:
    if not user:
        return False
    if user.role == "admin":
        return True
    return book.publisher_id == user.id


def _get_visible_book(
    db: Session,
    book_id: str,
    user: User | None,
) -> Book:
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    publicly_visible = book.status == "published" and book.visibility == "listed"
    if not publicly_visible and not _can_manage_book(book, user):
        raise HTTPException(status_code=404, detail="Book not found.")
    return book


def _require_chapter_access(
    db: Session,
    *,
    book: Book,
    chapter_id: str,
) -> Chapter:
    """Notes/explain follow the chapter the reader already opened.

    Do not apply the paid-chapter purchase gate here. Reading still locks
    later groups; footnotes in an open chapter are part of that text.
    """
    chapter = db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book.id:
        raise HTTPException(status_code=404, detail="Chapter not found.")
    return chapter


def _entry_list_item(entry: GlossaryEntry, *, compact: bool) -> dict:
    aliases = aliases_from_storage(entry.aliases)
    item = {
        "id": entry.id,
        "name": entry.name,
        "aliases": aliases,
        "episode_key": entry.episode_key,
        "group_label": entry.group_label,
    }
    item["episode_title"] = entry.episode_title
    if not compact:
        item["summary"] = entry.summary
        item["gender"] = entry.gender or None
        item["age_band"] = entry.age_band or None
        item["tts_voice"] = entry.tts_voice or None
    return item


def _chapter_paragraphs(content: str) -> list[str]:
    return [
        re.sub(r"\s*\n\s*", " ", part).strip()
        for part in re.split(r"\n\s*\n", content)
        if part.strip()
    ]


@router.get("/{book_id}/glossary")
def list_glossary(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
    episode: str | None = None,
    compact: bool = True,
):
    book = _get_visible_book(db, book_id, user)
    stmt = select(GlossaryEntry).where(GlossaryEntry.book_id == book.id)
    if episode:
        stmt = stmt.where(GlossaryEntry.episode_key == episode.upper())
    stmt = stmt.order_by(GlossaryEntry.episode_key, GlossaryEntry.sort_key)
    rows = list(db.scalars(stmt))
    entries = [_entry_list_item(row, compact=compact) for row in rows]
    return {"count": len(entries), "entries": entries}


@router.post("/{book_id}/glossary")
async def upload_glossary(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
    file: UploadFile = File(...),
):
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    _assert_editable(book)

    if not file.filename:
        raise HTTPException(status_code=400, detail="A glossary DOCX is required.")
    ext = Path(file.filename).suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if ext != DOCX_EXT and content_type != DOCX_MIME:
        raise HTTPException(status_code=400, detail="Only DOCX glossaries are supported.")

    settings = get_settings()
    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File too large. Max {settings.max_upload_mb}MB.")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{book.id}-glossary-{uuid4().hex[:8]}.docx"
    stored_path = upload_dir / stored_name
    stored_path.write_bytes(content)

    try:
        parsed = parse_glossary_docx(stored_path)
    except Exception as exc:  # noqa: BLE001
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Could not parse glossary: {exc}") from exc

    if not parsed:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="No character entries found in glossary DOCX.")

    now = datetime.now(timezone.utc)
    db.execute(delete(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    db.execute(delete(ExplainCache).where(ExplainCache.book_id == book.id))

    rows: list[GlossaryEntry] = []
    for item in parsed:
        row = GlossaryEntry(
            id=generate(),
            book_id=book.id,
            episode_key=item.episode_key,
            episode_title=item.episode_title,
            group_label=item.group_label,
            name=item.name,
            aliases=aliases_to_storage(item.aliases),
            summary=item.summary,
            sort_key=item.sort_key,
            gender="",
            age_band="",
            presence="",
            tts_voice="",
            cast_locked=False,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        rows.append(row)

    active = get_active_tts(db)
    ensure_entries_cast(
        rows,
        engine=active.engine,
        narrator_voice=active.voice,
        max_voices=active.max_character_voices,
    )

    if book.status == "rejected":
        book.status = "draft"
    book.updated_at = now
    db.commit()

    return {
        "ok": True,
        "count": len(parsed),
        "episodes": sorted({item.episode_key for item in parsed if item.episode_key}),
        "cast": {
            "engine": active.engine,
            "voices": sorted({row.tts_voice for row in rows if row.tts_voice}),
        },
    }


@router.post("/{book_id}/chapters/{chapter_id}/explain")
async def explain_selection(
    book_id: str,
    chapter_id: str,
    body: ExplainBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    book = _get_visible_book(db, book_id, user)
    chapter = _require_chapter_access(db, book=book, chapter_id=chapter_id)

    query = (body.query or "").strip()
    if len(query) > 120:
        query = query[:120].rstrip()

    entries = list(db.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id)))
    episode_key = infer_episode_key(
        chapter.title, book.source_filename or "", book.title, query
    )

    selected: GlossaryEntry | None = None
    paragraph_explain = False
    note_candidates: list[dict] = []

    if body.entry_id:
        selected = next((row for row in entries if row.id == body.entry_id), None)
        if selected is None:
            raise HTTPException(status_code=404, detail="Glossary entry not found.")
    elif query:
        candidates = [
            (entry, score)
            for entry, score in find_glossary_matches(
                entries, query, episode_key=episode_key, limit=5
            )
        ]
        if not candidates:
            selected = None
        elif len(candidates) == 1 or candidates[0][1] >= 90:
            selected = candidates[0][0]
        else:
            return {
                "status": "candidates",
                "query": query,
                "candidates": [candidate_payload(entry, score) for entry, score in candidates],
                "card": None,
                "cache_hit": False,
                "ai_used": False,
            }
    elif body.paragraph_index is not None:
        paragraphs = _chapter_paragraphs(chapter.content)
        if body.paragraph_index < 0 or body.paragraph_index >= len(paragraphs):
            raise HTTPException(status_code=400, detail="paragraph_index out of range.")
        paragraph = paragraphs[body.paragraph_index]
        paragraph_explain = True
        query = paragraph_card_title(paragraph)
        note_candidates = [
            candidate_payload(entry, include_summary=True)
            for entry in find_names_in_text(entries, paragraph, episode_key=episode_key, limit=24)
        ]
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide query, entry_id, or paragraph_index.",
        )

    if not query and selected is not None:
        query = selected.name
    if not query:
        raise HTTPException(status_code=400, detail="Query is required.")

    editorial = bool(selected is not None and is_reader_note(selected))
    book_note = selected.summary if selected else ""
    # Footnotes and whole-paragraph taps wait for "Giải thích thêm".
    want_ai = bool(body.need_context) if (editorial or paragraph_explain) else bool(
        body.need_context or not book_note
    )

    if selected is not None:
        key = entry_cache_key(book_id=book.id, glossary_entry_id=selected.id)
    else:
        key = cache_key(
            book_id=book.id,
            chapter_id=chapter.id,
            query=query,
            glossary_entry_id=None,
            paragraph_index=body.paragraph_index,
            need_context=False,
        )
    cached = db.scalar(select(ExplainCache).where(ExplainCache.cache_key == key))
    passage = (
        single_paragraph(chapter.content, body.paragraph_index)
        if paragraph_explain
        else paragraph_window(chapter.content, body.paragraph_index)
    )
    if cached:
        card = loads_card(cached.response_json)
        generated = False
        if want_ai and not str(card.get("ai_context") or "").strip():
            settings = get_settings()
            ai_context = await maybe_generate_ai_context(
                settings=settings,
                query=query,
                book_note=book_note or str(card.get("book_note") or ""),
                passage=passage,
                need_context=True,
                editorial=editorial,
                passage_explain=paragraph_explain,
            )
            if ai_context:
                card["ai_context"] = ai_context
                sources = list(card.get("sources") or [])
                if "ai" not in sources:
                    sources.append("ai")
                card["sources"] = sources
                cached.response_json = dumps_card(card)
                db.commit()
                generated = True
        return {
            "status": "ok",
            "query": query,
            "candidates": note_candidates,
            "card": card,
            "cache_hit": not generated,
            "ai_used": bool(str(card.get("ai_context") or "").strip()),
        }

    settings = get_settings()
    ai_context = await maybe_generate_ai_context(
        settings=settings,
        query=query,
        book_note=book_note,
        passage=passage,
        need_context=want_ai,
        editorial=editorial,
        passage_explain=paragraph_explain,
    )

    if book_note or ai_context:
        card = compose_card(
            query=query,
            entry=selected,
            ai_context=ai_context,
            sources=(["book"] if book_note else []) + (["ai"] if ai_context else []),
        )
    elif paragraph_explain:
        card = compose_card(
            query=query,
            entry=None,
            ai_context="",
            sources=[],
            followups=[],
        )
    else:
        card = compose_card(
            query=query,
            entry=selected,
            ai_context=(
                "No book note found for this name, and AI context is disabled."
                if not settings.ai_explain_enabled
                else "No reliable note found for this name."
            ),
            sources=[],
            followups=[],
        )

    now = datetime.now(timezone.utc)
    db.add(
        ExplainCache(
            id=generate(),
            book_id=book.id,
            chapter_id=chapter.id,
            cache_key=key,
            response_json=dumps_card(card),
            created_at=now,
        )
    )
    db.commit()

    return {
        "status": "ok",
        "query": query,
        "candidates": note_candidates,
        "card": card,
        "cache_hit": False,
        "ai_used": bool(ai_context),
    }
