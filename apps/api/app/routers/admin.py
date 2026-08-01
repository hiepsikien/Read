from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
import json

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, joinedload

from ..auth import require_admin
from ..categories import category_payload, ensure_categories
from ..config import get_settings
from ..covers import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_EXT,
    cover_url_for,
    save_cover_bytes,
)
from ..db import get_db
from ..models import Book, Category, Chapter, ContentReport, GlossaryEntry, ModerationEvent, Series, User
from ..moderation import allowed_admin_actions, event_payload, record_moderation_event
from ..series_catalog import apply_series_placement, attach_series_fields
from ..glossary import aliases_from_storage, normalize_lookup
from ..cast_recommend import extract_dialogue_samples, recommend_cast_for_character
from ..speaking_cast import speaking_cast_plan
from ..tts_settings import active_payload, get_active_tts, tts_settings_payload, upsert_tts_settings
from .. import tts
from ..voice_cast import (
    CAST_PERSONAS,
    MAX_CHARACTER_VOICES_CAP,
    apply_cast_to_entries,
    cast_profiles_for_entries,
    ensure_entries_cast,
    infer_age_band,
    infer_gender,
    infer_presence,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class RejectBody(BaseModel):
    note: str = Field(min_length=3, max_length=4000)


class ApproveBody(BaseModel):
    featured: bool = False


class FeatureBody(BaseModel):
    featured: bool


class VisibilityBody(BaseModel):
    visibility: Literal["listed", "hidden", "removed"]
    note: str = Field(default="", max_length=4000)


class ResolveReportBody(BaseModel):
    action: Literal["resolve", "dismiss", "hide"]
    note: str = Field(default="", max_length=4000)


class TtsSettingsBody(BaseModel):
    engine: str = Field(min_length=1, max_length=32)
    gender: str = Field(min_length=1, max_length=16)
    chirp_persona: str = Field(default="", max_length=64)
    narrator_rate: int | None = Field(default=None, ge=80, le=120)
    narrator_pitch: int | None = Field(default=None, ge=-6, le=6)
    dialogue_rate: int | None = Field(default=None, ge=80, le=120)
    dialogue_pitch: int | None = Field(default=None, ge=-6, le=6)
    break_start_ms: int | None = Field(default=None, ge=0, le=800)
    break_end_ms: int | None = Field(default=None, ge=0, le=800)
    speak_speaker_names: bool | None = None
    speak_stage_directions: bool | None = None
    max_character_voices: int | None = Field(
        default=None, ge=1, le=MAX_CHARACTER_VOICES_CAP
    )


class CastEntryUpdate(BaseModel):
    id: str | None = Field(default=None, max_length=32)
    speaker_key: str | None = Field(default=None, max_length=300)
    gender: Literal["male", "female"]
    age_band: Literal["youth", "adult", "elder"]
    presence: Literal["soft", "neutral", "forceful"]
    tts_voice: str = Field(min_length=1, max_length=128)
    cast_locked: bool = True


class CastUpdateBody(BaseModel):
    entries: list[CastEntryUpdate] = Field(min_length=1)


class CastRebuildBody(BaseModel):
    unlock: bool = False


class CastStatusBody(BaseModel):
    status: Literal["draft", "ready"]


class CastRecommendBody(BaseModel):
    entry_id: str | None = Field(default=None, max_length=32)
    speaker_key: str | None = Field(default=None, max_length=300)
    # Voices already chosen for other characters in the admin draft (optional).
    used_voices: list[str] = Field(default_factory=list, max_length=200)


class AdminCatalogBody(BaseModel):
    title: str | None = None
    description: str | None = None
    pricing: Literal["free", "paid"] | None = None
    price: float | None = None
    category_id: str | None = None
    series_id: str | None = None
    season_number: int | None = None
    episode_number: int | None = None
    clear_series: bool = False


class PatchUserRoleBody(BaseModel):
    role: Literal["reader", "publisher"]


def _user_list_item(user: User, *, book_count: int = 0) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "handle": user.handle,
        "role": user.role,
        "created_at": user.created_at.isoformat(),
        "book_count": book_count,
    }


def _report_count(db: Session, book_id: str, status: str | None = "open") -> int:
    query = select(func.count()).select_from(ContentReport).where(
        ContentReport.book_id == book_id
    )
    if status:
        query = query.where(ContentReport.status == status)
    return db.scalar(query) or 0


def _assert_listed_published(book: Book) -> None:
    if book.status != "published" or book.visibility != "listed":
        raise HTTPException(
            status_code=400,
            detail="Only listed published books can be edited by admin.",
        )


def _get_category(db: Session, category_id: str | None) -> Category | None:
    if not category_id:
        return None
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=400, detail="Unknown category.")
    return category


def _load_cast_overrides(book: Book) -> dict:
    raw = getattr(book, "cast_overrides", None) or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _save_cast_overrides(book: Book, overrides: dict) -> None:
    book.cast_overrides = json.dumps(overrides, ensure_ascii=False)


def _resolve_cast_override(overrides: dict, *keys: str) -> dict | None:
    """Pick the best override among cue/name keys.

    Screenplay cues are often short (Xavier) while glossary names are full
    (Francis Xavier). Saves historically keyed by name; UI/TTS look up by cue.
    Prefer a locked override when keys disagree so stale cue rows cannot hide a
    locked glossary save.
    """
    candidates: list[dict] = []
    seen: set[str] = set()
    for key in keys:
        normalized = normalize_lookup(key or "")
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        meta = overrides.get(normalized)
        if isinstance(meta, dict):
            candidates.append(meta)
    if not candidates:
        return None
    for meta in candidates:
        if bool(meta.get("cast_locked")):
            return meta
    return candidates[0]


def _write_cast_override(overrides: dict, meta: dict, *keys: str) -> None:
    """Store the same override under every provided lookup key (cue + name)."""
    for key in keys:
        normalized = normalize_lookup(key or "")
        if normalized:
            overrides[normalized] = meta


def _cast_warnings(book: Book, *, unmatched_count: int = 0, speaking_count: int = 0) -> list[str]:
    warnings: list[str] = []
    if (getattr(book, "cast_status", "draft") or "draft") != "ready":
        warnings.append("Audio cast is not marked ready.")
    if unmatched_count:
        warnings.append(f"{unmatched_count} unmatched speaking cue(s).")
    if speaking_count == 0:
        warnings.append("No screenplay dialogue speakers were detected.")
    return warnings


def _queue_item(book: Book, chapter_count: int, report_count: int = 0) -> dict:
    item = {
        "id": book.id,
        "title": book.title,
        "description": book.description,
        "price_cents": book.price_cents,
        "status": book.status,
        "featured": book.featured,
        "featured_at": book.featured_at.isoformat() if book.featured_at else None,
        "visibility": book.visibility,
        "visibility_note": book.visibility_note,
        "chapter_count": chapter_count,
        "report_count": report_count,
        "publisher_name": book.publisher.name if book.publisher else "",
        "publisher_handle": book.publisher.handle if book.publisher else None,
        "publisher_id": book.publisher_id,
        "category": category_payload(book.category),
        "source_filename": book.source_filename,
        "submitted_at": book.submitted_at.isoformat() if book.submitted_at else None,
        "reviewed_at": book.reviewed_at.isoformat() if book.reviewed_at else None,
        "created_at": book.created_at.isoformat(),
        "updated_at": book.updated_at.isoformat(),
        "review_note": book.review_note,
        "cover_url": cover_url_for(book.id, book.cover_path),
        "cast_status": getattr(book, "cast_status", None) or "draft",
    }
    return attach_series_fields(item, book)


@router.get("/summary")
def admin_summary(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    pending_count = (
        db.scalar(
            select(func.count()).select_from(Book).where(Book.status == "pending_review")
        )
        or 0
    )
    listed_count = (
        db.scalar(
            select(func.count())
            .select_from(Book)
            .where(Book.status == "published", Book.visibility == "listed")
        )
        or 0
    )
    featured_count = (
        db.scalar(
            select(func.count())
            .select_from(Book)
            .where(
                Book.status == "published",
                Book.visibility == "listed",
                Book.featured.is_(True),
            )
        )
        or 0
    )
    rejected_count = (
        db.scalar(
            select(func.count()).select_from(Book).where(Book.status == "rejected")
        )
        or 0
    )
    hidden_count = (
        db.scalar(
            select(func.count())
            .select_from(Book)
            .where(Book.status == "published", Book.visibility == "hidden")
        )
        or 0
    )
    removed_count = (
        db.scalar(
            select(func.count())
            .select_from(Book)
            .where(Book.status == "published", Book.visibility == "removed")
        )
        or 0
    )
    library_count = (
        db.scalar(
            select(func.count())
            .select_from(Book)
            .where(Book.status.in_({"published", "rejected"}))
        )
        or 0
    )
    open_reports = (
        db.scalar(
            select(func.count())
            .select_from(ContentReport)
            .where(ContentReport.status == "open")
        )
        or 0
    )
    resolved_reports = (
        db.scalar(
            select(func.count())
            .select_from(ContentReport)
            .where(ContentReport.status == "resolved")
        )
        or 0
    )
    dismissed_reports = (
        db.scalar(
            select(func.count())
            .select_from(ContentReport)
            .where(ContentReport.status == "dismissed")
        )
        or 0
    )
    series_count = db.scalar(select(func.count()).select_from(Series)) or 0
    return {
        "pending_count": pending_count,
        "library_count": library_count,
        "report_count": open_reports + resolved_reports + dismissed_reports,
        "series_count": series_count,
        "library_counts": {
            "listed": listed_count,
            "featured": featured_count,
            "rejected": rejected_count,
            "hidden": hidden_count,
            "removed": removed_count,
        },
        "report_counts": {
            "open": open_reports,
            "resolved": resolved_reports,
            "dismissed": dismissed_reports,
        },
    }


@router.get("/queue")
def moderation_queue(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    books = (
        db.query(Book)
        .options(joinedload(Book.publisher), joinedload(Book.category), joinedload(Book.series))
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
        items.append(_queue_item(book, chapter_count, _report_count(db, book.id)))
    return {"books": items}


@router.get("/books")
def admin_books(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
    status: str | None = None,
    visibility: str | None = None,
    featured: int | None = None,
    q: str | None = None,
):
    query = db.query(Book).options(
        joinedload(Book.publisher),
        joinedload(Book.category),
        joinedload(Book.series),
    )
    if status:
        if status not in {"draft", "pending_review", "published", "rejected"}:
            raise HTTPException(status_code=400, detail="Invalid book status.")
        query = query.filter(Book.status == status)
    else:
        query = query.filter(Book.status.in_({"published", "rejected"}))
    if visibility:
        if visibility not in {"listed", "hidden", "removed"}:
            raise HTTPException(status_code=400, detail="Invalid visibility.")
        query = query.filter(Book.visibility == visibility)
    if featured is not None:
        query = query.filter(Book.featured.is_(featured == 1))
    needle = (q or "").strip()
    if needle:
        query = query.join(User, User.id == Book.publisher_id).filter(
            or_(
                Book.title.ilike(f"%{needle}%"),
                User.name.ilike(f"%{needle}%"),
                User.email.ilike(f"%{needle}%"),
            )
        )
    books = query.order_by(Book.updated_at.desc()).all()
    return {
        "books": [
            _queue_item(
                book,
                db.scalar(
                    select(func.count()).select_from(Chapter).where(
                        Chapter.book_id == book.id
                    )
                )
                or 0,
                _report_count(db, book.id),
            )
            for book in books
        ]
    }


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
        joinedload(Book.series),
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
            **_queue_item(book, len(chapters), _report_count(db, book.id)),
            "has_raw_text": bool(book.raw_text),
            "reviewed_at": book.reviewed_at.isoformat() if book.reviewed_at else None,
            "allowed_actions": allowed_admin_actions(book),
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
        "moderation_history": [
            event_payload(event)
            for event in (
                db.query(ModerationEvent)
                .filter(ModerationEvent.book_id == book.id)
                .order_by(ModerationEvent.created_at.desc())
                .limit(50)
                .all()
            )
        ],
    }


@router.patch("/books/{book_id}")
def admin_update_book_catalog(
    book_id: str,
    body: AdminCatalogBody,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    ensure_categories(db)
    book = (
        db.query(Book)
        .options(joinedload(Book.category), joinedload(Book.series))
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    content_update = any(
        value is not None
        for value in (body.title, body.description, body.pricing, body.price, body.category_id)
    )
    series_update = body.clear_series or any(
        value is not None
        for value in (body.series_id, body.season_number, body.episode_number)
    )
    if not content_update and not series_update:
        raise HTTPException(status_code=400, detail="No changes provided.")

    if content_update:
        _assert_listed_published(book)

    previous = {
        "title": book.title,
        "description": book.description,
        "price_cents": book.price_cents,
        "category_id": book.category_id,
        "series_id": book.series_id,
        "season_number": book.season_number,
        "episode_number": book.episode_number,
    }

    if content_update:
        title = body.title.strip() if body.title is not None else book.title
        description = (
            body.description.strip() if body.description is not None else book.description
        )
        if not title:
            raise HTTPException(status_code=400, detail="Title is required.")

        price_cents = book.price_cents
        if body.pricing == "free":
            price_cents = 0
        elif body.pricing == "paid" or body.price is not None:
            dollars = body.price if body.price is not None else price_cents / 100
            price_cents = max(1, round((dollars if dollars == dollars else 1) * 100))

        if body.category_id is not None:
            category = _get_category(db, body.category_id.strip() or None)
            if not category:
                raise HTTPException(status_code=400, detail="Category is required.")
            book.category_id = category.id

        book.title = title
        book.description = description
        book.price_cents = price_cents

    if series_update:
        apply_series_placement(
            db,
            book,
            series_id=body.series_id,
            season_number=body.season_number,
            episode_number=body.episode_number,
            clear_series=body.clear_series,
        )

    book.updated_at = datetime.now(timezone.utc)

    changes = {}
    if previous["title"] != book.title:
        changes["title"] = {"from": previous["title"], "to": book.title}
    if previous["description"] != book.description:
        changes["description"] = {
            "from": previous["description"],
            "to": book.description,
        }
    if previous["price_cents"] != book.price_cents:
        changes["price_cents"] = {
            "from": previous["price_cents"],
            "to": book.price_cents,
        }
    if previous["category_id"] != book.category_id:
        changes["category_id"] = {
            "from": previous["category_id"],
            "to": book.category_id,
        }
    if (
        previous["series_id"] != book.series_id
        or previous["season_number"] != book.season_number
        or previous["episode_number"] != book.episode_number
    ):
        changes["series_placement"] = {
            "from": {
                "series_id": previous["series_id"],
                "season_number": previous["season_number"],
                "episode_number": previous["episode_number"],
            },
            "to": {
                "series_id": book.series_id,
                "season_number": book.season_number,
                "episode_number": book.episode_number,
            },
        }

    if changes:
        record_moderation_event(
            db,
            book=book,
            actor=admin,
            action="edit_catalog",
            payload={"changes": changes},
        )
    db.commit()
    db.refresh(book)
    if book.series_id and book.series is None:
        book.series = db.get(Series, book.series_id)
    return {
        "ok": True,
        "book": attach_series_fields(
            {
                "id": book.id,
                "title": book.title,
                "description": book.description,
                "price_cents": book.price_cents,
                "status": book.status,
                "visibility": book.visibility,
                "featured": book.featured,
                "category": category_payload(book.category),
                "cover_url": cover_url_for(book.id, book.cover_path),
                "updated_at": book.updated_at.isoformat(),
            },
            book,
        ),
    }


@router.post("/books/{book_id}/cover")
async def admin_upload_book_cover(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
    file: UploadFile = File(...),
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    _assert_listed_published(book)

    if not file.filename:
        raise HTTPException(status_code=400, detail="A cover image is required.")
    ext = Path(file.filename).suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if ext not in ALLOWED_EXT and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Cover must be a JPEG, PNG, or WebP image.")

    raw = await file.read()
    settings = get_settings()
    try:
        cover_path = save_cover_bytes(settings.upload_dir, book.id, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    previous_cover = book.cover_path
    book.cover_path = cover_path
    book.updated_at = datetime.now(timezone.utc)
    record_moderation_event(
        db,
        book=book,
        actor=admin,
        action="replace_cover",
        payload={"from": previous_cover, "to": cover_path},
    )
    db.commit()
    return {"ok": True, "cover_url": cover_url_for(book.id, cover_path)}


@router.post("/books/{book_id}/approve")
def approve_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
    body: Annotated[ApproveBody | None, Body()] = None,
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
    make_featured = bool(body and body.featured)
    result = db.execute(
        update(Book)
        .where(Book.id == book.id, Book.status == "pending_review")
        .values(
            status="published",
            visibility="listed",
            featured=make_featured,
            featured_at=now if make_featured else None,
            featured_by=admin.id if make_featured else None,
            reviewed_at=now,
            reviewed_by=admin.id,
            review_note=None,
            updated_at=now,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This book was already reviewed.")
    record_moderation_event(
        db,
        book=book,
        actor=admin,
        action="approve_featured" if make_featured else "approve",
        from_status="pending_review",
        to_status="published",
        from_visibility=book.visibility,
        to_visibility="listed",
        payload={"featured": make_featured},
    )
    db.commit()
    refreshed = db.get(Book, book_id)
    plan = speaking_cast_plan(
        list(db.scalars(select(Chapter).where(Chapter.book_id == book_id))),
        list(db.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book_id))),
    )
    warnings = _cast_warnings(
        refreshed or book,
        unmatched_count=plan["unmatched_count"],
        speaking_count=plan["speaking_count"],
    )
    return {
        "ok": True,
        "status": "published",
        "visibility": "listed",
        "featured": make_featured,
        "cast_status": getattr(refreshed or book, "cast_status", None) or "draft",
        "warnings": warnings,
    }


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
    result = db.execute(
        update(Book)
        .where(Book.id == book.id, Book.status == "pending_review")
        .values(
            status="rejected",
            featured=False,
            featured_at=None,
            featured_by=None,
            reviewed_at=now,
            reviewed_by=admin.id,
            review_note=note,
            updated_at=now,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This book was already reviewed.")
    record_moderation_event(
        db,
        book=book,
        actor=admin,
        action="reject",
        from_status="pending_review",
        to_status="rejected",
        note=note,
    )
    db.commit()
    return {"ok": True, "status": "rejected", "review_note": note}


@router.post("/books/{book_id}/feature")
def set_book_featured(
    book_id: str,
    body: FeatureBody,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.status != "published" or book.visibility != "listed":
        raise HTTPException(
            status_code=400,
            detail="Only listed published books can be featured.",
        )
    if book.featured == body.featured:
        return {"ok": True, "featured": book.featured}
    now = datetime.now(timezone.utc)
    book.featured = body.featured
    book.featured_at = now if body.featured else None
    book.featured_by = admin.id if body.featured else None
    book.updated_at = now
    record_moderation_event(
        db,
        book=book,
        actor=admin,
        action="feature" if body.featured else "unfeature",
        payload={"featured": body.featured},
    )
    db.commit()
    return {"ok": True, "featured": book.featured}


@router.post("/books/{book_id}/visibility")
def set_book_visibility(
    book_id: str,
    body: VisibilityBody,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.status != "published":
        raise HTTPException(
            status_code=400,
            detail="Visibility can only change for published books.",
        )
    if book.visibility == "removed":
        raise HTTPException(status_code=400, detail="Removed books cannot be restored.")
    if body.visibility == "listed" and book.visibility != "hidden":
        raise HTTPException(status_code=400, detail="Only hidden books can be relisted.")
    if body.visibility == "hidden" and book.visibility != "listed":
        raise HTTPException(status_code=400, detail="Only listed books can be hidden.")
    if body.visibility == book.visibility:
        return {"ok": True, "visibility": book.visibility, "featured": book.featured}

    previous = book.visibility
    note = body.note.strip()
    if body.visibility in {"hidden", "removed"} and len(note) < 3:
        raise HTTPException(status_code=400, detail="A moderation note is required.")
    now = datetime.now(timezone.utc)
    book.visibility = body.visibility
    book.visibility_note = note or None
    book.visibility_changed_at = now
    book.visibility_changed_by = admin.id
    if body.visibility != "listed":
        book.featured = False
        book.featured_at = None
        book.featured_by = None
    book.updated_at = now
    record_moderation_event(
        db,
        book=book,
        actor=admin,
        action={
            "listed": "relist",
            "hidden": "hide",
            "removed": "remove",
        }[body.visibility],
        from_visibility=previous,
        to_visibility=body.visibility,
        note=note or None,
    )
    db.commit()
    return {
        "ok": True,
        "visibility": book.visibility,
        "featured": book.featured,
    }


def _report_payload(report: ContentReport, book: Book, reporter: User | None) -> dict:
    return {
        "id": report.id,
        "book_id": report.book_id,
        "book_title": book.title,
        "book_visibility": book.visibility,
        "reporter_user_id": report.reporter_user_id,
        "reporter_name": reporter.name if reporter else "Deleted user",
        "reporter_email": reporter.email if reporter else "",
        "reason": report.reason,
        "details": report.details,
        "status": report.status,
        "created_at": report.created_at.isoformat(),
        "resolved_at": report.resolved_at.isoformat() if report.resolved_at else None,
        "resolved_by": report.resolved_by,
        "resolution_note": report.resolution_note,
    }


@router.get("/reports")
def admin_reports(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
    status: str = "open",
):
    if status not in {"open", "resolved", "dismissed"}:
        raise HTTPException(status_code=400, detail="Invalid report status.")
    rows = (
        db.query(ContentReport, Book, User)
        .join(Book, Book.id == ContentReport.book_id)
        .outerjoin(User, User.id == ContentReport.reporter_user_id)
        .filter(ContentReport.status == status)
        .order_by(ContentReport.created_at.desc())
        .all()
    )
    return {
        "reports": [
            _report_payload(report, book, reporter)
            for report, book, reporter in rows
        ]
    }


@router.post("/reports/{report_id}/resolve")
def resolve_report(
    report_id: str,
    body: ResolveReportBody,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    report = db.get(ContentReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if report.status != "open":
        raise HTTPException(status_code=400, detail="Only open reports can be resolved.")
    book = db.get(Book, report.book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    note = body.note.strip()
    now = datetime.now(timezone.utc)
    if body.action == "hide":
        if book.status != "published" or book.visibility != "listed":
            raise HTTPException(status_code=400, detail="This book cannot be hidden.")
        book.visibility = "hidden"
        book.visibility_note = note or f"Hidden after report {report.id}"
        book.visibility_changed_at = now
        book.visibility_changed_by = admin.id
        book.featured = False
        book.featured_at = None
        book.featured_by = None
        book.updated_at = now
        record_moderation_event(
            db,
            book=book,
            actor=admin,
            action="hide_from_report",
            from_visibility="listed",
            to_visibility="hidden",
            note=book.visibility_note,
            payload={"report_id": report.id},
        )
        report.status = "resolved"
    elif body.action == "dismiss":
        report.status = "dismissed"
    else:
        report.status = "resolved"
    report.resolved_at = now
    report.resolved_by = admin.id
    report.resolution_note = note or None
    db.commit()
    return {
        "ok": True,
        "status": report.status,
        "book_visibility": book.visibility,
    }


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
            narrator_rate=body.narrator_rate,
            narrator_pitch=body.narrator_pitch,
            dialogue_rate=body.dialogue_rate,
            dialogue_pitch=body.dialogue_pitch,
            break_start_ms=body.break_start_ms,
            break_end_ms=body.break_end_ms,
            speak_speaker_names=body.speak_speaker_names,
            speak_stage_directions=body.speak_stage_directions,
            max_character_voices=body.max_character_voices,
            admin_id=admin.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "ok": True,
        "active": active_payload(active),
    }


def _cast_entry_payload(
    *,
    entry: GlossaryEntry | None,
    speaker_cue: str,
    speaker_key: str,
    matched: bool,
    line_count: int,
    first_chapter_id: str,
    first_chapter_title: str,
    first_chapter_position: int,
    override: dict | None = None,
    source: Literal["speaking", "glossary_only", "unmatched"] | None = None,
) -> dict:
    override = override or {}
    if entry is not None:
        return {
            "id": entry.id,
            "speaker_key": speaker_key,
            "speaker_cue": speaker_cue,
            "name": entry.name,
            "aliases": aliases_from_storage(entry.aliases),
            "episode_key": entry.episode_key,
            "group_label": entry.group_label,
            "summary": entry.summary,
            "gender": override.get("gender") or entry.gender or None,
            "age_band": override.get("age_band") or entry.age_band or None,
            "presence": override.get("presence") or entry.presence or None,
            "tts_voice": override.get("tts_voice") or entry.tts_voice or None,
            "cast_locked": bool(
                override.get("cast_locked")
                if "cast_locked" in override
                else entry.cast_locked
            ),
            "matched": matched,
            "line_count": line_count,
            "first_chapter_id": first_chapter_id,
            "first_chapter_title": first_chapter_title,
            "first_chapter_position": first_chapter_position,
            "source": source or ("speaking" if matched else "glossary_only"),
        }
    return {
        "id": None,
        "speaker_key": speaker_key,
        "speaker_cue": speaker_cue,
        "name": speaker_cue,
        "aliases": [],
        "episode_key": "",
        "group_label": "",
        "summary": "",
        "gender": override.get("gender") or infer_gender(speaker_cue, ""),
        "age_band": override.get("age_band") or infer_age_band(speaker_cue, ""),
        "presence": override.get("presence") or infer_presence(speaker_cue, ""),
        "tts_voice": override.get("tts_voice") or None,
        "cast_locked": bool(override.get("cast_locked", False)),
        "matched": False,
        "line_count": line_count,
        "first_chapter_id": first_chapter_id,
        "first_chapter_title": first_chapter_title,
        "first_chapter_position": first_chapter_position,
        "source": source or "unmatched",
    }


@router.get("/books/{book_id}/cast")
def get_book_cast(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
    scope: Literal["speaking", "all"] = "speaking",
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    active = get_active_tts(db)
    rows = list(
        db.scalars(
            select(GlossaryEntry)
            .where(GlossaryEntry.book_id == book.id)
            .order_by(GlossaryEntry.episode_key, GlossaryEntry.sort_key)
        )
    )
    chapters = list(db.scalars(select(Chapter).where(Chapter.book_id == book.id)))
    ensure_entries_cast(
        rows,
        engine=active.engine,
        narrator_voice=active.voice,
        max_voices=active.max_character_voices,
    )
    db.commit()

    plan = speaking_cast_plan(chapters, rows)
    overrides = _load_cast_overrides(book)
    entries: list[dict] = []

    for item in plan["speaking"]:
        entry = item["glossary_entry"]
        key = item["speaker_key"]
        entries.append(
            _cast_entry_payload(
                entry=entry,
                speaker_cue=item["speaker_cue"],
                speaker_key=key,
                matched=True,
                line_count=item["line_count"],
                first_chapter_id=item["first_chapter_id"],
                first_chapter_title=item["first_chapter_title"],
                first_chapter_position=item["first_chapter_position"],
                override=_resolve_cast_override(
                    overrides, key, normalize_lookup(entry.name)
                ),
                source="speaking",
            )
        )
    for item in plan["unmatched"]:
        key = item["speaker_key"]
        entries.append(
            _cast_entry_payload(
                entry=None,
                speaker_cue=item["speaker_cue"],
                speaker_key=key,
                matched=False,
                line_count=item["line_count"],
                first_chapter_id=item["first_chapter_id"],
                first_chapter_title=item["first_chapter_title"],
                first_chapter_position=item["first_chapter_position"],
                override=overrides.get(key) if isinstance(overrides.get(key), dict) else None,
                source="unmatched",
            )
        )

    if scope == "all":
        speaking_ids = {e["id"] for e in entries if e.get("id")}
        for entry in plan["glossary_only"]:
            if entry.id in speaking_ids:
                continue
            key = normalize_lookup(entry.name)
            entries.append(
                _cast_entry_payload(
                    entry=entry,
                    speaker_cue=entry.name,
                    speaker_key=key,
                    matched=True,
                    line_count=0,
                    first_chapter_id="",
                    first_chapter_title="",
                    first_chapter_position=0,
                    override=overrides.get(key) if isinstance(overrides.get(key), dict) else None,
                    source="glossary_only",
                )
            )

    warnings = _cast_warnings(
        book,
        unmatched_count=plan["unmatched_count"],
        speaking_count=plan["speaking_count"],
    )
    return {
        "book_id": book.id,
        "book_title": book.title,
        "engine": active.engine,
        "narrator_voice": active.voice,
        "cast_status": getattr(book, "cast_status", None) or "draft",
        "scope": scope,
        "speaking_count": plan["speaking_count"],
        "glossary_count": plan["glossary_count"],
        "unmatched_count": plan["unmatched_count"],
        "warnings": warnings,
        "cast_personas": CAST_PERSONAS,
        "voices": tts.voice_options(),
        "entries": entries,
    }


@router.put("/books/{book_id}/cast")
def update_book_cast(
    book_id: str,
    body: CastUpdateBody,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    active = get_active_tts(db)
    rows = list(
        db.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    )
    by_id = {row.id: row for row in rows}
    overrides = _load_cast_overrides(book)
    now = datetime.now(timezone.utc)
    updated = 0
    for item in body.entries:
        gender = item.gender
        persona = item.tts_voice.rsplit("-", 1)[-1]
        if active.engine == "chirp3":
            allowed = set(CAST_PERSONAS[gender]) | set(tts.CHIRP3_PERSONAS[gender])
            if persona not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=f"Voice {item.tts_voice} does not match gender {gender}.",
                )

        meta = {
            "gender": gender,
            "age_band": item.age_band,
            "presence": item.presence,
            "tts_voice": item.tts_voice,
            "cast_locked": bool(item.cast_locked),
        }
        if item.id:
            seed = by_id.get(item.id)
            if seed is None or seed.book_id != book.id:
                raise HTTPException(status_code=404, detail=f"Cast entry {item.id} not found.")
            key = normalize_lookup(seed.name)
            for row in rows:
                if normalize_lookup(row.name) != key:
                    continue
                row.gender = gender
                row.age_band = item.age_band
                row.presence = item.presence
                row.tts_voice = item.tts_voice
                row.cast_locked = bool(item.cast_locked)
                row.updated_at = now
                updated += 1
            # Write under glossary name and screenplay cue so TTS/UI both hit.
            _write_cast_override(overrides, meta, key, item.speaker_key or "")
        else:
            key = normalize_lookup(item.speaker_key or "")
            if not key:
                raise HTTPException(status_code=400, detail="speaker_key is required for unmatched cues.")
            _write_cast_override(overrides, meta, key)
            updated += 1

    _save_cast_overrides(book, overrides)
    if (getattr(book, "cast_status", None) or "draft") == "ready":
        # Edits after ready send it back to draft until re-confirmed.
        book.cast_status = "draft"
    book.updated_at = now
    db.commit()
    return {"ok": True, "updated": updated, "cast_status": book.cast_status}


@router.post("/books/{book_id}/cast/recommend")
async def recommend_book_cast_entry(
    book_id: str,
    body: CastRecommendBody,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    entry_id = (body.entry_id or "").strip() or None
    speaker_key = normalize_lookup(body.speaker_key or "")
    if not entry_id and not speaker_key:
        raise HTTPException(
            status_code=400,
            detail="entry_id or speaker_key is required.",
        )

    rows = list(
        db.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    )
    chapters = list(
        db.scalars(
            select(Chapter)
            .where(Chapter.book_id == book.id)
            .order_by(Chapter.position.asc())
        )
    )

    entry: GlossaryEntry | None = None
    if entry_id:
        entry = next((row for row in rows if row.id == entry_id), None)
        if entry is None:
            raise HTTPException(status_code=404, detail="Cast entry not found.")
    else:
        entry = next(
            (row for row in rows if normalize_lookup(row.name) == speaker_key),
            None,
        )

    name = (entry.name if entry else body.speaker_key or "").strip()
    aliases = aliases_from_storage(entry.aliases) if entry else []
    summary = (entry.summary if entry else "") or ""
    cue = name
    speaker_keys = {normalize_lookup(name)} if name else set()
    if speaker_key:
        speaker_keys.add(speaker_key)
        cue = (body.speaker_key or cue).strip() or cue
    for alias in aliases:
        key = normalize_lookup(alias)
        if key:
            speaker_keys.add(key)

    if not entry and body.speaker_key:
        cue = body.speaker_key.strip()

    dialogue = extract_dialogue_samples(chapters, speaker_keys=speaker_keys)
    active = get_active_tts(db)

    used = {
        (getattr(row, "tts_voice", "") or "").strip()
        for row in rows
        if (getattr(row, "tts_voice", "") or "").strip()
        and (entry is None or row.id != entry.id)
    }
    for voice in body.used_voices:
        cleaned = (voice or "").strip()
        if cleaned:
            used.add(cleaned)
    current_voice = (entry.tts_voice if entry else "") or ""
    used.discard(current_voice.strip())

    recommendation = await recommend_cast_for_character(
        settings=get_settings(),
        name=name or cue,
        aliases=aliases,
        summary=summary,
        speaker_cue=cue,
        dialogue_samples=dialogue,
        engine=active.engine,
        narrator_voice=active.voice,
        used_voices=used,
        max_voices=active.max_character_voices,
    )
    return {
        "ok": True,
        "entry_id": entry.id if entry else None,
        "speaker_key": speaker_key or normalize_lookup(name),
        "name": name or cue,
        **recommendation,
    }


@router.post("/books/{book_id}/cast/rebuild")
def rebuild_book_cast(
    book_id: str,
    body: CastRebuildBody,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    active = get_active_tts(db)
    rows = list(
        db.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    )
    profiles = cast_profiles_for_entries(
        rows,
        engine=active.engine,
        narrator_voice=active.voice,
        max_voices=active.max_character_voices,
    )
    updated = apply_cast_to_entries(rows, profiles, unlock=body.unlock)
    if body.unlock:
        _save_cast_overrides(book, {})
    book.cast_status = "draft"
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "updated": updated, "cast_status": book.cast_status}


@router.post("/books/{book_id}/cast/status")
def set_book_cast_status(
    book_id: str,
    body: CastStatusBody,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    book.cast_status = body.status
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    chapters = list(db.scalars(select(Chapter).where(Chapter.book_id == book.id)))
    rows = list(db.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id)))
    plan = speaking_cast_plan(chapters, rows)
    return {
        "ok": True,
        "cast_status": book.cast_status,
        "warnings": _cast_warnings(
            book,
            unmatched_count=plan["unmatched_count"],
            speaking_count=plan["speaking_count"],
        ),
    }


@router.get("/users")
def list_users(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
    q: str | None = None,
    role: Literal["reader", "publisher", "admin"] | None = None,
    limit: int = 50,
):
    limit = max(1, min(limit, 100))
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        query = query.filter(
            or_(
                User.email.ilike(like),
                User.name.ilike(like),
                User.handle.ilike(like),
            )
        )
    rows = query.order_by(User.created_at.desc()).limit(limit).all()
    if not rows:
        return {"users": []}
    ids = [user.id for user in rows]
    book_counts = dict(
        db.execute(
            select(Book.publisher_id, func.count())
            .where(Book.publisher_id.in_(ids))
            .group_by(Book.publisher_id)
        ).all()
    )
    return {
        "users": [
            _user_list_item(user, book_count=int(book_counts.get(user.id) or 0))
            for user in rows
        ]
    }


@router.patch("/users/{user_id}")
def patch_user_role(
    user_id: str,
    body: PatchUserRoleBody,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.role == "admin":
        raise HTTPException(
            status_code=400,
            detail="Admin roles cannot be changed here. Use ADMIN_EMAILS.",
        )
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role.")

    target.role = body.role
    db.commit()
    db.refresh(target)
    book_count = (
        db.scalar(
            select(func.count()).select_from(Book).where(Book.publisher_id == target.id)
        )
        or 0
    )
    return {"ok": True, "user": _user_list_item(target, book_count=int(book_count))}

