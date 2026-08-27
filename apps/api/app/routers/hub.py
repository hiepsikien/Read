"""Knowledge Hub ingest — plain-text works, not DOCX publisher upload."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import hash_password
from ..categories import ensure_categories
from ..chapters import count_words, split_into_chapters
from ..config import get_settings
from ..db import get_db
from ..handles import normalize_handle
from ..models import Book, Chapter, User

router = APIRouter(prefix="/api/internal/hub", tags=["hub"])


class HubWorkIn(BaseModel):
    hub_work_id: str = Field(min_length=3, max_length=120)
    hub_version: int = 1
    hub_content_hash: str | None = None
    title: str = Field(min_length=1, max_length=500)
    description: str = ""
    language: str = "en"
    license: str | None = None
    source_url: str = ""
    category_slug: str = "essays"
    price_cents: int = 0
    split_length: str = "standard"
    status: str = "pending_review"
    hub_license_snapshot: dict[str, Any] | None = None
    raw_text: str = Field(min_length=1)


def _require_hub_token(x_hub_sync_token: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().hub_sync_token.strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Hub sync is not configured.")
    if not x_hub_sync_token or x_hub_sync_token != expected:
        raise HTTPException(status_code=401, detail="Invalid hub sync token.")


def _hub_publisher(db: Session) -> User:
    email = "knowledgehub@read.app"
    user = db.scalar(select(User).where(User.email == email))
    if user:
        if user.role == "reader":
            user.role = "publisher"
        return user
    now = datetime.now(timezone.utc)
    user_id = generate()
    base = normalize_handle("knowledgehub") or "knowledgehub"
    handle = base[:30]
    suffix = 0
    while db.scalar(select(User).where(User.handle == handle)):
        suffix += 1
        stem = base[: max(1, 30 - len(str(suffix)) - 1)]
        handle = f"{stem}{suffix}"
    user = User(
        id=user_id,
        firebase_uid=f"hub-{user_id}",
        email=email,
        name="Knowledge Hub",
        handle=handle,
        role="publisher",
        password_hash=hash_password("hub-sync-disabled-login"),
        created_at=now,
    )
    db.add(user)
    db.flush()
    return user


@router.post("/works")
def upsert_hub_work(
    body: HubWorkIn,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_hub_token)],
) -> dict[str, Any]:
    if body.status not in {"draft", "pending_review", "published"}:
        raise HTTPException(status_code=400, detail="Invalid status.")
    categories = ensure_categories(db)
    category = next((c for c in categories if c.slug == body.category_slug), None)
    if not category:
        category = next((c for c in categories if c.slug == "other"), categories[0])
    publisher = _hub_publisher(db)
    now = datetime.now(timezone.utc)
    book = db.scalar(select(Book).where(Book.hub_work_id == body.hub_work_id))
    created = book is None
    if book is None:
        book = Book(
            id=generate(),
            publisher_id=publisher.id,
            category_id=category.id,
            title=body.title,
            description=body.description or body.title,
            created_at=now,
            updated_at=now,
        )
        db.add(book)
        db.flush()
    elif book.hub_content_hash and body.hub_content_hash == book.hub_content_hash:
        return {
            "id": book.id,
            "hub_work_id": body.hub_work_id,
            "unchanged": True,
            "chapter_count": len(book.chapters),
        }

    units = split_into_chapters(
        body.raw_text, preserve_paragraphs=True, length=body.split_length
    )
    if not units:
        raise HTTPException(status_code=400, detail="Could not split manuscript into chapters.")

    book.publisher_id = publisher.id
    book.category_id = category.id
    book.title = body.title
    book.description = body.description or body.title
    book.price_cents = max(0, body.price_cents)
    book.status = body.status
    book.source_filename = f"{body.hub_work_id}.txt"
    book.source_path = None
    book.raw_text = body.raw_text
    book.hub_work_id = body.hub_work_id
    book.hub_version = body.hub_version
    book.hub_content_hash = body.hub_content_hash
    book.hub_license_snapshot = json.dumps(body.hub_license_snapshot or {}, ensure_ascii=False)
    book.updated_at = now
    if body.status == "pending_review":
        book.submitted_at = now

    db.execute(delete(Chapter).where(Chapter.book_id == book.id))
    for index, unit in enumerate(units):
        db.add(
            Chapter(
                id=generate(),
                book_id=book.id,
                position=index + 1,
                title=unit.title,
                content=unit.content,
                word_count=count_words(unit.content),
                group_index=unit.group_index,
            )
        )
    db.commit()
    return {
        "id": book.id,
        "hub_work_id": body.hub_work_id,
        "created": created,
        "unchanged": False,
        "chapter_count": len(units),
        "status": book.status,
    }
