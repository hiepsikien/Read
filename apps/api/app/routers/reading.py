"""Authenticated reading shelf (in-progress books)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from ..auth import get_current_user
from ..db import get_db
from ..models import Book, Chapter, ReadingProgress, User
from .books import (
    _book_list_item,
    _can_manage_book,
    _has_purchase,
    _is_publicly_visible,
    _resolve_progress_chapter,
)

router = APIRouter(prefix="/api/reading", tags=["reading"])


@router.get("")
def list_reading(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    # selectinload(chapters) avoids joinedload cartesian duplicates of progress rows.
    rows = (
        db.query(ReadingProgress)
        .options(
            joinedload(ReadingProgress.book).joinedload(Book.publisher),
            joinedload(ReadingProgress.book).joinedload(Book.category),
            joinedload(ReadingProgress.book).selectinload(Book.chapters),
        )
        .filter(
            ReadingProgress.user_id == user.id,
            ReadingProgress.completed_at.is_(None),
        )
        .order_by(ReadingProgress.updated_at.desc())
        .all()
    )

    items = []
    seen_book_ids: set[str] = set()
    for row in rows:
        book = row.book
        if not book or book.id in seen_book_ids:
            continue
        seen_book_ids.add(book.id)
        # Continue shelf is a reader surface: never surface hidden/removed/draft
        # re-uploads even when the signed-in user can manage those books.
        if not _is_publicly_visible(book):
            continue
        chapter = _resolve_progress_chapter(book, row)
        if not chapter:
            continue
        purchased = _has_purchase(db, user.id, book.id)
        from ..access import can_access_chapter

        is_manager = _can_manage_book(book, user)
        if not is_manager and not can_access_chapter(
            book=book,
            chapter=chapter,
            user_id=user.id,
            purchased=purchased,
        ):
            continue

        chapter_count = (
            db.scalar(
                select(func.count()).select_from(Chapter).where(Chapter.book_id == book.id)
            )
            or 0
        )
        book_item = _book_list_item(
            book,
            chapter_count=chapter_count,
            publisher_name=book.publisher.name if book.publisher else None,
            publisher_handle=book.publisher.handle if book.publisher else None,
        )
        items.append(
            {
                "book": book_item,
                "progress": {
                    "chapter_id": chapter.id,
                    "chapter_title": chapter.title,
                    "chapter_position": chapter.position,
                    "chapter_count": chapter_count,
                    "paragraph_index": max(0, int(row.paragraph_index or 0)),
                    "scroll_fraction": max(0.0, min(1.0, float(row.scroll_fraction or 0.0))),
                    "updated_at": row.updated_at.isoformat(),
                    "completed_at": None,
                },
            }
        )

    return {"items": items}
