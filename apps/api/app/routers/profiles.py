from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..handles import normalize_handle, validate_handle
from ..models import Book, Chapter, User
from ..routers.books import _book_list_item

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


@router.get("/{handle}")
def get_profile(handle: str, db: Annotated[Session, Depends(get_db)]):
    try:
        normalized = validate_handle(handle)
    except HTTPException:
        # Invalid format should look like a missing profile to callers.
        raise HTTPException(status_code=404, detail="Profile not found.") from None

    user = db.query(User).filter(User.handle == normalized).one_or_none()
    if not user:
        # Also try normalize in case stored values somehow differ; primary path is exact.
        user = (
            db.query(User)
            .filter(User.handle == normalize_handle(handle))
            .one_or_none()
        )
    if not user or not user.handle:
        raise HTTPException(status_code=404, detail="Profile not found.")

    books_query = (
        db.query(Book)
        .options(joinedload(Book.category), joinedload(Book.publisher))
        .filter(
            Book.publisher_id == user.id,
            Book.status == "published",
            Book.visibility == "listed",
        )
        .order_by(Book.created_at.desc())
    )
    books = []
    for book in books_query.all():
        chapter_count = (
            db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book.id))
            or 0
        )
        books.append(
            _book_list_item(
                book,
                chapter_count=chapter_count,
                publisher_name=user.name,
                publisher_handle=user.handle,
            )
        )

    return {
        "profile": {
            "id": user.id,
            "name": user.name,
            "handle": user.handle,
            "role": user.role,
        },
        "books": books,
    }
