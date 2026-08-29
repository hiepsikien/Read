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
from ..glossary import aliases_to_storage
from ..handles import normalize_handle
from ..credits import apply_credits
from ..models import Book, Chapter, GlossaryEntry, User

router = APIRouter(prefix="/api/internal/hub", tags=["hub"])


class HubGlossaryEntry(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    aliases: list[str] = Field(default_factory=list)
    summary: str = ""
    group_label: str = "Chú thích"
    kind: str = ""
    marker: str = ""
    anchor: str = ""
    chapter: str = ""


class HubNote(BaseModel):
    id: str = ""
    kind: str = "footnote"
    label: str = Field(min_length=1, max_length=300)
    marker: str = ""
    anchor: str = ""
    chapter: str = ""
    body: str = ""
    group_label: str = "Chú thích"


class HubSourceWork(BaseModel):
    hub_work_id: str = ""
    title: str = ""
    year: int | None = None
    language: str = ""


class HubCredits(BaseModel):
    author_name: str = ""
    author_hub_id: str = ""
    translator_name: str = ""
    translator_role: str = ""
    source: HubSourceWork | None = None


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
    glossary: list[HubGlossaryEntry] | None = None
    notes: list[HubNote] | None = None
    credits: HubCredits | None = None


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


def _notes_as_glossary(notes: list[HubNote]) -> list[HubGlossaryEntry]:
    rows: list[HubGlossaryEntry] = []
    for item in notes:
        aliases = [item.marker.strip()] if item.marker.strip() and item.marker.strip() != item.label else []
        if item.kind != "footnote" and item.anchor.strip() and item.anchor.strip() != item.label:
            aliases.append(item.anchor.strip())
        rows.append(
            HubGlossaryEntry(
                name=item.label.strip()[:300],
                aliases=aliases[:12],
                summary=(item.body or "")[:8000],
                group_label=(item.group_label or "Chú thích")[:200],
                kind=item.kind,
                marker=item.marker.strip(),
                anchor=item.anchor.strip(),
                chapter=item.chapter.strip(),
            )
        )
    return rows


def _upsert_hub_glossary(
    db: Session,
    book: Book,
    entries: list[HubGlossaryEntry] | None,
    notes: list[HubNote] | None = None,
) -> int:
    if notes is not None:
        entries = _notes_as_glossary(notes)
    elif entries is None:
        return -1
    now = datetime.now(timezone.utc)
    db.execute(delete(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    for item in entries:
        aliases = [a.strip() for a in item.aliases if str(a).strip()][:12]
        marker = (item.marker or "").strip()
        if marker and marker not in aliases and marker != item.name.strip():
            aliases.insert(0, marker)
        db.add(
            GlossaryEntry(
                id=generate(),
                book_id=book.id,
                episode_key=(item.chapter or "")[:32],
                episode_title=(item.anchor or "")[:300],
                group_label=(item.group_label or "Chú thích")[:200],
                name=item.name.strip()[:300],
                aliases=aliases_to_storage(aliases),
                summary=(item.summary or "")[:8000],
                sort_key=item.name.casefold()[:300],
                gender="",
                age_band="",
                presence="",
                tts_voice="",
                cast_locked=True,
                created_at=now,
                updated_at=now,
            )
        )
    return len(entries)


@router.post("/works")
def create_hub_work(
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
    units = split_into_chapters(
        body.raw_text, preserve_paragraphs=True, length=body.split_length
    )
    if not units:
        raise HTTPException(status_code=400, detail="Could not split manuscript into chapters.")

    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=category.id,
        title=body.title,
        description=body.description or body.title,
        price_cents=max(0, body.price_cents),
        status=body.status,
        source_filename=f"{body.hub_work_id}.txt",
        raw_text=body.raw_text,
        hub_work_id=body.hub_work_id,
        hub_version=body.hub_version,
        hub_content_hash=body.hub_content_hash,
        hub_license_snapshot=json.dumps(body.hub_license_snapshot or {}, ensure_ascii=False),
        submitted_at=now if body.status == "pending_review" else None,
        created_at=now,
        updated_at=now,
    )
    db.add(book)
    db.flush()
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
    glossary_count = _upsert_hub_glossary(db, book, body.glossary, body.notes)
    if body.credits is not None:
        apply_credits(book, body.credits.model_dump())
    db.commit()
    return {
        "id": book.id,
        "hub_work_id": body.hub_work_id,
        "created": True,
        "unchanged": False,
        "chapter_count": len(units),
        "glossary_count": 0 if glossary_count < 0 else glossary_count,
        "status": book.status,
    }
