from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..auth import require_admin
from ..categories import category_payload
from ..db import get_db
from ..models import Book, Chapter, User
from ..tts_settings import get_active_tts, tts_settings_payload, upsert_tts_settings

router = APIRouter(prefix="/api/admin", tags=["admin"])


class RejectBody(BaseModel):
    note: str = Field(min_length=3, max_length=4000)


class TtsSettingsBody(BaseModel):
    engine: str = Field(min_length=1, max_length=32)
    gender: str = Field(min_length=1, max_length=16)
    chirp_persona: str = Field(default="", max_length=64)


def _queue_item(book: Book, chapter_count: int) -> dict:
    return {
        "id": book.id,
        "title": book.title,
        "description": book.description,
        "price_cents": book.price_cents,
        "status": book.status,
        "chapter_count": chapter_count,
        "publisher_name": book.publisher.name if book.publisher else "",
        "publisher_id": book.publisher_id,
        "category": category_payload(book.category),
        "source_filename": book.source_filename,
        "submitted_at": book.submitted_at.isoformat() if book.submitted_at else None,
        "created_at": book.created_at.isoformat(),
        "updated_at": book.updated_at.isoformat(),
        "review_note": book.review_note,
    }


@router.get("/queue")
def moderation_queue(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    books = (
        db.query(Book)
        .options(joinedload(Book.publisher), joinedload(Book.category))
        .filter(Book.status == "pending_review")
        .order_by(Book.submitted_at.asc(), Book.updated_at.asc())
        .all()
    )
    items = []
    for book in books:
        chapter_count = (
            db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book.id))
            or 0
        )
        items.append(_queue_item(book, chapter_count))
    return {"books": items}


@router.get("/books/{book_id}")
def moderation_detail(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    book = (
        db.query(Book)
        .options(
            joinedload(Book.publisher),
            joinedload(Book.category),
            joinedload(Book.chapters),
        )
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    chapters = sorted(book.chapters, key=lambda c: c.position)
    return {
        "book": {
            **_queue_item(book, len(chapters)),
            "has_raw_text": bool(book.raw_text),
            "reviewed_at": book.reviewed_at.isoformat() if book.reviewed_at else None,
        },
        "chapters": [
            {
                "id": chapter.id,
                "position": chapter.position,
                "title": chapter.title,
                "word_count": chapter.word_count,
                "group_index": chapter.group_index,
                "content_preview": chapter.content[:1200],
            }
            for chapter in chapters
        ],
    }


@router.post("/books/{book_id}/approve")
def approve_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.status != "pending_review":
        raise HTTPException(status_code=400, detail="Only pending books can be approved.")

    chapter_count = (
        db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book_id)) or 0
    )
    if chapter_count == 0:
        raise HTTPException(status_code=400, detail="Book has no chapters to publish.")

    now = datetime.now(timezone.utc)
    book.status = "published"
    book.reviewed_at = now
    book.reviewed_by = admin.id
    book.review_note = None
    book.updated_at = now
    db.commit()
    return {"ok": True, "status": book.status}


@router.post("/books/{book_id}/reject")
def reject_book(
    book_id: str,
    body: RejectBody,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.status != "pending_review":
        raise HTTPException(status_code=400, detail="Only pending books can be rejected.")

    note = body.note.strip()
    if len(note) < 3:
        raise HTTPException(status_code=400, detail="A rejection note is required.")

    now = datetime.now(timezone.utc)
    book.status = "rejected"
    book.reviewed_at = now
    book.reviewed_by = admin.id
    book.review_note = note
    book.updated_at = now
    db.commit()
    return {"ok": True, "status": book.status, "review_note": book.review_note}


@router.get("/settings/tts")
def get_tts_settings(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    return tts_settings_payload(db)


@router.put("/settings/tts")
def update_tts_settings(
    body: TtsSettingsBody,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    try:
        active = upsert_tts_settings(
            db,
            engine=body.engine,
            gender=body.gender,
            chirp_persona=body.chirp_persona,
            admin_id=admin.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "ok": True,
        "active": {
            "engine": active.engine,
            "gender": active.gender,
            "chirp_persona": active.chirp_persona,
            "voice_override": active.voice_override,
            "voice": active.voice,
            "enabled": active.enabled,
            "source": active.source,
        },
    }
