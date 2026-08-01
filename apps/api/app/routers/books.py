import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import unquote

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError
from nanoid import generate
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..access import can_access_chapter
from ..auth import get_current_user, get_current_user_optional, require_publisher
from ..categories import category_payload, ensure_categories
from ..chapters import (
    SPLIT_PROFILES,
    count_words,
    materialize_split_chapters,
    split_into_chapter_drafts,
)
from ..config import get_settings
from ..db import get_db
from ..legal import require_current_legal_acceptance
from ..models import (
    Book,
    Category,
    Chapter,
    ContentReport,
    GlossaryEntry,
    Purchase,
    ReadingProgress,
    Series,
    User,
)
from ..moderation import record_moderation_event
from ..publisher_suggest import suggest_metadata, suggest_segment_names
from ..gemini import gemini_available
from ..segment_titles import (
    format_segment_title,
    normalize_suggest_language,
    normalize_title_components,
)
from ..covers import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_EXT,
    cover_absolute_path,
    cover_url_for,
    save_cover_bytes,
    try_extract_and_save_cover,
)
from ..media import media_absolute_path
from ..parse_docs import extract_text_from_file
from ..recommendations import RECOMMEND_LIMIT, rank_related, sort_same_author
from ..series_catalog import apply_series_placement, attach_series_fields, find_next_episode
from ..tts_settings import get_active_tts
from .. import tts

logger = logging.getLogger(__name__)


def _glossary_voice_map(
    db: Session,
    book_id: str,
    *,
    engine: str,
    narrator_voice: str,
    max_voices: int = 3,
) -> tuple[dict[str, str], dict[str, str]]:
    import json

    from ..models import Book
    from ..voice_cast import apply_cast_to_entries, cast_profiles_for_entries

    entries = list(
        db.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book_id))
    )
    book = db.get(Book, book_id)
    profiles = (
        cast_profiles_for_entries(
            entries,
            engine=engine,
            narrator_voice=narrator_voice,
            max_voices=max_voices,
        )
        if entries
        else {}
    )
    if entries and apply_cast_to_entries(entries, profiles):
        db.commit()
    voices = {key: profile.voice for key, profile in profiles.items()}
    presence = {key: profile.presence for key, profile in profiles.items()}

    raw = getattr(book, "cast_overrides", None) if book else "{}"
    try:
        overrides = json.loads(raw or "{}")
    except json.JSONDecodeError:
        overrides = {}
    if isinstance(overrides, dict):
        for key, meta in overrides.items():
            if not isinstance(meta, dict):
                continue
            voice = (meta.get("tts_voice") or "").strip()
            if voice:
                voices[str(key)] = voice
            value = (meta.get("presence") or "").strip()
            if value:
                presence[str(key)] = value
    return voices, presence

router = APIRouter(prefix="/api/books", tags=["books"])

DOCX_EXT = ".docx"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
EDITABLE_STATUSES = {"draft", "rejected"}


class PatchBookBody(BaseModel):
    title: str | None = None
    description: str | None = None
    pricing: str | None = None
    price: float | None = None
    category_id: str | None = None
    series_id: str | None = None
    season_number: int | None = None
    episode_number: int | None = None
    clear_series: bool = False


class SplitBookBody(BaseModel):
    length: Literal["short", "standard", "long"] = "standard"
    # Ordered components for segment titles. Omit for legacy heading-based titles.
    title_components: list[Literal["book", "name", "part"]] | None = None
    # Language for Part label + AI distinctive names.
    title_language: Literal["en", "vi", "bilingual"] = "en"


class SegmentTitlesBody(BaseModel):
    title_components: list[Literal["book", "name", "part"]] | None = None
    title_language: Literal["en", "vi", "bilingual"] = "en"


class ReportBookBody(BaseModel):
    reason: Literal["copyright", "inappropriate", "spam", "misleading", "other"]
    details: str = ""


class SuggestMetadataBody(BaseModel):
    fields: list[Literal["category", "description"]] | None = None
    language: Literal["en", "vi", "bilingual"] = "en"


class SaveProgressBody(BaseModel):
    chapter_id: str
    paragraph_index: int = 0
    scroll_fraction: float = 0.0
    completed: bool | None = None


def _is_publicly_visible(book: Book) -> bool:
    return book.status == "published" and book.visibility == "listed"


def _chapter_list_item(chapter: Chapter, locked: bool | None = None) -> dict:
    item = {
        "id": chapter.id,
        "position": chapter.position,
        "title": chapter.title,
        "word_count": chapter.word_count,
        "group_index": chapter.group_index,
    }
    if locked is not None:
        item["locked"] = locked
    return item


def _book_list_item(
    book: Book,
    *,
    chapter_count: int,
    publisher_name: str | None = None,
    publisher_handle: str | None = None,
    for_public: bool = False,
) -> dict:
    item = {
        "id": book.id,
        "title": book.title,
        "description": book.description,
        "price_cents": book.price_cents,
        "status": book.status,
        "featured": book.featured,
        "visibility": book.visibility,
        "chapter_count": chapter_count,
        "created_at": book.created_at.isoformat(),
        "updated_at": book.updated_at.isoformat(),
        "category": category_payload(book.category),
        "review_note": book.review_note,
        "submitted_at": book.submitted_at.isoformat() if book.submitted_at else None,
        "reviewed_at": book.reviewed_at.isoformat() if book.reviewed_at else None,
        "cover_url": cover_url_for(book.id, book.cover_path),
    }
    if book.visibility in {"hidden", "removed"} and book.visibility_note:
        item["visibility_note"] = book.visibility_note
    if publisher_name is not None:
        item["publisher_name"] = publisher_name
    if publisher_handle is not None:
        item["publisher_handle"] = publisher_handle
    elif book.publisher is not None and getattr(book.publisher, "handle", None):
        item["publisher_handle"] = book.publisher.handle
    if book.publisher_id:
        item["publisher_id"] = book.publisher_id
    if book.source_filename is not None:
        item["source_filename"] = book.source_filename
    return attach_series_fields(item, book, for_public=for_public)


def _owned(book: Book, user: User | None, purchased: bool) -> bool:
    if not user:
        return book.price_cents == 0
    if book.publisher_id == user.id or book.price_cents == 0 or user.role == "admin":
        return True
    return purchased


def _apply_series_placement(
    db: Session,
    book: Book,
    *,
    series_id: str | None,
    season_number: int | None,
    episode_number: int | None,
    clear_series: bool,
) -> None:
    apply_series_placement(
        db,
        book,
        series_id=series_id,
        season_number=season_number,
        episode_number=episode_number,
        clear_series=clear_series,
    )


def _next_episode_payload(db: Session, book: Book) -> dict | None:
    nxt = find_next_episode(db, book)
    if not nxt:
        return None
    chapter_count = (
        db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == nxt.id)) or 0
    )
    return _book_list_item(
        nxt,
        chapter_count=int(chapter_count),
        publisher_name=nxt.publisher.name if nxt.publisher else None,
        publisher_handle=nxt.publisher.handle if nxt.publisher else None,
    )


def _has_purchase(db: Session, user_id: str, book_id: str) -> bool:
    row = db.scalar(
        select(Purchase.id).where(Purchase.user_id == user_id, Purchase.book_id == book_id)
    )
    return bool(row)


def _can_manage_book(book: Book, user: User | None) -> bool:
    if not user:
        return False
    if user.role == "admin":
        return True
    return book.publisher_id == user.id


def _accessible_chapter(
    db: Session,
    *,
    book_id: str,
    chapter_id: str,
    user: User | None,
) -> tuple[Book, Chapter]:
    book = (
        db.query(Book)
        .options(joinedload(Book.chapters))
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    is_manager = _can_manage_book(book, user)
    if not _is_publicly_visible(book) and not is_manager:
        raise HTTPException(status_code=404, detail="Book not found.")

    chapter = next((item for item in book.chapters if item.id == chapter_id), None)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    purchased = bool(user and _has_purchase(db, user.id, book.id))
    if not is_manager and not can_access_chapter(
        book=book,
        chapter=chapter,
        user_id=user.id if user else None,
        purchased=purchased,
    ):
        raise HTTPException(status_code=402, detail="Purchase required to listen to this chapter.")
    return book, chapter


def _assert_editable(book: Book) -> None:
    if book.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="This book is locked while under review or published. Rejected and draft books can be edited.",
        )


def _resolve_progress_chapter(
    book: Book, progress: ReadingProgress
) -> Chapter | None:
    chapters = sorted(book.chapters, key=lambda c: c.position)
    if not chapters:
        return None
    if progress.chapter_id:
        match = next((c for c in chapters if c.id == progress.chapter_id), None)
        if match:
            return match
    if progress.chapter_position is not None:
        by_position = next(
            (c for c in chapters if c.position == progress.chapter_position), None
        )
        if by_position:
            return by_position
        # Clamp to the nearest existing chapter when the saved position is gone.
        if progress.chapter_position < chapters[0].position:
            return chapters[0]
        if progress.chapter_position > chapters[-1].position:
            return chapters[-1]
    return None


def _progress_payload(
    db: Session,
    *,
    book: Book,
    user: User | None,
    purchased: bool,
    is_manager: bool,
) -> dict | None:
    if not user:
        return None
    row = (
        db.query(ReadingProgress)
        .filter(ReadingProgress.user_id == user.id, ReadingProgress.book_id == book.id)
        .one_or_none()
    )
    if not row:
        return None
    chapter = _resolve_progress_chapter(book, row)
    if not chapter:
        return None
    if not is_manager and not can_access_chapter(
        book=book,
        chapter=chapter,
        user_id=user.id,
        purchased=purchased,
    ):
        return None
    return {
        "chapter_id": chapter.id,
        "paragraph_index": max(0, int(row.paragraph_index or 0)),
        "scroll_fraction": max(0.0, min(1.0, float(row.scroll_fraction or 0.0))),
        "updated_at": row.updated_at.isoformat(),
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def _get_category(db: Session, category_id: str | None) -> Category | None:
    if not category_id:
        return None
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=400, detail="Unknown category.")
    return category


@router.get("/categories/list")
def list_categories(db: Annotated[Session, Depends(get_db)]):
    categories = ensure_categories(db)
    return {
        "categories": [
            {"id": c.id, "slug": c.slug, "label": c.label} for c in categories
        ]
    }


@router.get("")
def list_books(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
    mine: int = 0,
    category: str | None = None,
):
    if mine == 1:
        if not user or user.role not in {"publisher", "admin"}:
            raise HTTPException(status_code=403, detail="Publisher login required.")
        books = (
            db.query(Book)
            .options(joinedload(Book.category), joinedload(Book.series))
            .filter(Book.publisher_id == user.id)
            .order_by(Book.updated_at.desc())
            .all()
        )
        result = []
        for book in books:
            chapter_count = (
                db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book.id))
                or 0
            )
            result.append(_book_list_item(book, chapter_count=chapter_count))
        return {"books": result}

    query = (
        db.query(Book)
        .options(joinedload(Book.category), joinedload(Book.publisher), joinedload(Book.series))
        .filter(Book.status == "published", Book.visibility == "listed")
        .order_by(Book.featured.desc(), Book.featured_at.desc(), Book.created_at.desc())
    )
    if category:
        query = query.join(Category, Category.id == Book.category_id).filter(
            (Category.slug == category) | (Category.id == category)
        )
    books = []
    for book in query.all():
        chapter_count = (
            db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book.id))
            or 0
        )
        books.append(
            _book_list_item(
                book,
                chapter_count=chapter_count,
                publisher_name=book.publisher.name if book.publisher else "",
                publisher_handle=book.publisher.handle if book.publisher else None,
                for_public=True,
            )
        )
    return {"books": books}


@router.post("")
async def create_book(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
    title: Annotated[str, Form()] = "",
    description: Annotated[str, Form()] = "",
    pricing: Annotated[str, Form()] = "free",
    price: Annotated[float, Form()] = 0,
    category_id: Annotated[str, Form()] = "",
    file: UploadFile = File(...),
):
    settings = get_settings()
    title = title.strip()
    description = description.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    categories = ensure_categories(db)
    category = _get_category(db, category_id.strip() or None)
    if not category:
        # Upload-first flow: category can be chosen later (AI suggest / edit).
        category = next((item for item in categories if item.slug == "other"), None) or (
            categories[0] if categories else None
        )
    if not category:
        raise HTTPException(status_code=400, detail="Category is required.")
    if not file.filename:
        raise HTTPException(status_code=400, detail="A DOCX manuscript is required.")

    original_name = unquote(file.filename).strip() or file.filename
    ext = Path(original_name).suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if ext != DOCX_EXT and content_type != DOCX_MIME:
        raise HTTPException(
            status_code=400,
            detail="Only DOCX manuscripts are supported. PDF uploads are disabled.",
        )
    if ext != DOCX_EXT:
        ext = DOCX_EXT

    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max {settings.max_upload_mb}MB.",
        )

    price_cents = (
        max(1, round((price if price == price else 0) * 100)) if pricing == "paid" else 0
    )

    book_id = generate()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{book_id}{ext}"
    stored_path = upload_dir / stored_name
    stored_path.write_bytes(content)

    try:
        raw_text = extract_text_from_file(
            stored_path,
            original_name if original_name.lower().endswith(".docx") else f"{original_name}.docx",
            media_dir=upload_dir,
            book_id=book_id,
        )
    except Exception as exc:  # noqa: BLE001
        stored_path.unlink(missing_ok=True)
        logger.exception("Text extraction failed for %s", original_name)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cover_path = try_extract_and_save_cover(upload_dir, book_id, stored_path)

    now = datetime.now(timezone.utc)
    book = Book(
        id=book_id,
        publisher_id=user.id,
        category_id=category.id,
        title=title,
        description=description,
        price_cents=price_cents,
        status="draft",
        source_filename=original_name,
        source_path=stored_name,
        cover_path=cover_path,
        raw_text=raw_text,
        created_at=now,
        updated_at=now,
    )
    db.add(book)
    db.commit()
    return {
        "id": book_id,
        "cover_url": cover_url_for(book_id, cover_path),
    }


@router.get("/{book_id}")
def get_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    book = (
        db.query(Book)
        .options(
            joinedload(Book.publisher),
            joinedload(Book.chapters),
            joinedload(Book.category),
            joinedload(Book.series),
        )
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    is_manager = _can_manage_book(book, user)
    if not _is_publicly_visible(book) and not is_manager:
        raise HTTPException(status_code=404, detail="Book not found.")

    purchased = bool(user and _has_purchase(db, user.id, book.id))
    chapters = sorted(book.chapters, key=lambda c: c.position)
    book_payload = attach_series_fields(
        {
            "id": book.id,
            "title": book.title,
            "description": book.description,
            "price_cents": book.price_cents,
            "status": book.status,
            "featured": book.featured,
            "visibility": book.visibility,
            "publisher_name": book.publisher.name,
            "publisher_handle": book.publisher.handle if book.publisher else None,
            "publisher_id": book.publisher_id,
            "source_filename": book.source_filename,
            "created_at": book.created_at.isoformat(),
            "updated_at": book.updated_at.isoformat(),
            "has_raw_text": bool(book.raw_text),
            "category": category_payload(book.category),
            "review_note": book.review_note,
            "submitted_at": book.submitted_at.isoformat() if book.submitted_at else None,
            "reviewed_at": book.reviewed_at.isoformat() if book.reviewed_at else None,
            "cover_url": cover_url_for(book.id, book.cover_path),
        },
        book,
        for_public=not is_manager,
    )
    book_payload["next_episode"] = _next_episode_payload(db, book)
    return {
        "book": book_payload,
        "chapters": [_chapter_list_item(c) for c in chapters],
        "access": {
            "owned": _owned(book, user, purchased),
            "isPublisherOwner": bool(user and user.id == book.publisher_id),
            "previewChapterId": chapters[0].id if chapters else None,
            "progress": _progress_payload(
                db,
                book=book,
                user=user,
                purchased=purchased,
                is_manager=is_manager,
            ),
        },
    }


def _chapter_counts(db: Session, book_ids: list[str]) -> dict[str, int]:
    if not book_ids:
        return {}
    rows = db.execute(
        select(Chapter.book_id, func.count())
        .where(Chapter.book_id.in_(book_ids))
        .group_by(Chapter.book_id)
    ).all()
    return {book_id: int(count) for book_id, count in rows}


def _serialize_book_rows(db: Session, books: list[Book]) -> list[dict]:
    counts = _chapter_counts(db, [book.id for book in books])
    return [
        _book_list_item(
            book,
            chapter_count=counts.get(book.id, 0),
            publisher_name=book.publisher.name if book.publisher else None,
            publisher_handle=book.publisher.handle if book.publisher else None,
        )
        for book in books
    ]


@router.get("/{book_id}/recommendations")
def get_book_recommendations(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    book = (
        db.query(Book)
        .options(joinedload(Book.publisher), joinedload(Book.category), joinedload(Book.series))
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    is_manager = _can_manage_book(book, user)
    if not _is_publicly_visible(book) and not is_manager:
        raise HTTPException(status_code=404, detail="Book not found.")

    public_query = (
        db.query(Book)
        .options(joinedload(Book.category), joinedload(Book.publisher), joinedload(Book.series))
        .filter(
            Book.status == "published",
            Book.visibility == "listed",
            Book.id != book.id,
        )
    )

    same_author_books = sort_same_author(
        public_query.filter(Book.publisher_id == book.publisher_id).all()
    )[:RECOMMEND_LIMIT]
    same_author_ids = {item.id for item in same_author_books}

    related_candidates = public_query.filter(Book.publisher_id != book.publisher_id).all()
    # Prefer same-category peers; still allow fill from other categories via scoring.
    related_books = rank_related(
        source=book,
        candidates=related_candidates,
        exclude_ids=same_author_ids,
        limit=RECOMMEND_LIMIT,
    )

    next_episode = _next_episode_payload(db, book)
    next_owned = None
    if next_episode is not None:
        nxt_book = find_next_episode(db, book)
        if nxt_book is not None:
            next_owned = _owned(
                nxt_book,
                user,
                bool(user and _has_purchase(db, user.id, nxt_book.id)),
            )

    return {
        "next_episode": next_episode,
        "next_episode_owned": next_owned,
        "same_author": _serialize_book_rows(db, same_author_books),
        "related": _serialize_book_rows(db, related_books),
    }


@router.get("/{book_id}/cover")
def get_book_cover(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    book = db.get(Book, book_id)
    if not book or not book.cover_path:
        raise HTTPException(status_code=404, detail="Cover not found.")

    is_manager = _can_manage_book(book, user)
    if not _is_publicly_visible(book) and not is_manager:
        raise HTTPException(status_code=404, detail="Cover not found.")

    settings = get_settings()
    path = Path(settings.upload_dir) / book.cover_path
    if not path.is_file():
        # Fall back to canonical location if DB path is stale/relative-only.
        path = cover_absolute_path(settings.upload_dir, book.id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Cover not found.")

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": (
                "public, max-age=86400"
                if _is_publicly_visible(book)
                else "private, no-store"
            )
        },
    )


@router.get("/{book_id}/media/{asset_filename}")
def get_book_media(
    book_id: str,
    asset_filename: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    """Serve an inline figure extracted from the manuscript."""
    if "/" in asset_filename or "\\" in asset_filename or ".." in asset_filename:
        raise HTTPException(status_code=404, detail="Media not found.")
    if not asset_filename.lower().endswith(".jpg"):
        raise HTTPException(status_code=404, detail="Media not found.")
    asset_id = asset_filename[:-4]
    if not asset_id or not all(ch.isalnum() for ch in asset_id):
        raise HTTPException(status_code=404, detail="Media not found.")

    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Media not found.")

    is_manager = _can_manage_book(book, user)
    if not _is_publicly_visible(book) and not is_manager:
        raise HTTPException(status_code=404, detail="Media not found.")

    settings = get_settings()
    path = media_absolute_path(settings.upload_dir, book.id, asset_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Media not found.")

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": (
                "public, max-age=86400"
                if _is_publicly_visible(book)
                else "private, no-store"
            )
        },
    )


@router.post("/{book_id}/cover")
async def upload_book_cover(
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

    book.cover_path = cover_path
    if book.status == "rejected":
        book.status = "draft"
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "cover_url": cover_url_for(book.id, cover_path)}


@router.delete("/{book_id}")
def discard_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    """Permanently discard a draft book owned by the publisher."""
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.status != "draft":
        raise HTTPException(
            status_code=400,
            detail="Only draft books can be discarded. Withdraw from review or unpublish first.",
        )

    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    for relative in (book.source_path, book.cover_path):
        if not relative:
            continue
        try:
            (upload_dir / relative).unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not delete upload file %s for book %s", relative, book_id)

    db.delete(book)
    db.commit()
    return {"ok": True}


@router.patch("/{book_id}")
def patch_book(
    book_id: str,
    body: PatchBookBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
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
        _assert_editable(book)
        title = body.title.strip() if body.title is not None else book.title
        description = body.description.strip() if body.description is not None else book.description
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

        previous_status = book.status
        book.title = title
        book.description = description
        book.price_cents = price_cents
        if previous_status == "rejected":
            book.status = "draft"
            book.review_note = book.review_note  # keep last note for author context

    if series_update:
        _apply_series_placement(
            db,
            book,
            series_id=body.series_id,
            season_number=body.season_number,
            episode_number=body.episode_number,
            clear_series=body.clear_series,
        )

    book.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="That season/episode slot is already taken in this series.",
        ) from None
    return {"ok": True, "status": book.status}


@router.post("/{book_id}/suggest-metadata")
async def suggest_book_metadata(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
    body: Annotated[SuggestMetadataBody | None, Body()] = None,
):
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    _assert_editable(book)
    if not (book.raw_text or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Upload a manuscript before requesting AI suggestions.",
        )

    settings = get_settings()
    if not gemini_available(settings):
        return JSONResponse(
            status_code=503,
            content={"error": "ai_unavailable", "detail": "AI suggestions are unavailable."},
        )

    fields = body.fields if body and body.fields else ["category", "description"]
    want_category = "category" in fields
    want_description = "description" in fields
    if not want_category and not want_description:
        raise HTTPException(status_code=400, detail="Choose at least one field to suggest.")

    try:
        suggestion = await suggest_metadata(
            settings=settings,
            title=book.title,
            raw_text=book.raw_text or "",
            want_category=want_category,
            want_description=want_description,
            language=body.language if body else "en",
        )
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Upload a manuscript before requesting AI suggestions.",
        ) from None
    except RuntimeError:
        return JSONResponse(
            status_code=503,
            content={"error": "ai_unavailable", "detail": "AI suggestions are unavailable."},
        )

    category_payload_result = None
    if want_category and suggestion.get("category_slug"):
        categories = ensure_categories(db)
        match = next(
            (item for item in categories if item.slug == suggestion["category_slug"]),
            None,
        )
        category_payload_result = category_payload(match)

    description = suggestion.get("description") if want_description else None
    if description == "":
        description = None

    return {
        "category": category_payload_result,
        "description": description,
        "ai_used": True,
    }


@router.post("/{book_id}/split")
async def split_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
    body: Annotated[SplitBookBody | None, Body()] = None,
):
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    _assert_editable(book)
    if not (book.raw_text or "").strip():
        raise HTTPException(status_code=400, detail="No extracted text available to split.")

    length = (body.length if body else "standard")
    if length not in SPLIT_PROFILES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid length. Expected one of: {', '.join(SPLIT_PROFILES)}.",
        )

    title_components = None
    if body is not None and "title_components" in body.model_fields_set:
        title_components = normalize_title_components(body.title_components or [])

    title_language = normalize_suggest_language(
        body.title_language if body else "en"
    )

    drafts = split_into_chapter_drafts(
        book.raw_text or "", preserve_paragraphs=True, length=length
    )
    if not drafts:
        raise HTTPException(status_code=400, detail="Could not create chapters from this document.")

    distinctive_names: list[str] | None = None
    if title_components is not None and "name" in title_components:
        settings = get_settings()
        if gemini_available(settings):
            try:
                distinctive_names = await suggest_segment_names(
                    settings=settings,
                    book_title=book.title,
                    segments=[{"sample": d.sample} for d in drafts],
                    language=title_language,
                )
            except RuntimeError:
                distinctive_names = None

    units = materialize_split_chapters(
        drafts,
        book_title=book.title,
        title_components=title_components,
        distinctive_names=distinctive_names,
        language=title_language,
    )

    db.query(Chapter).filter(Chapter.book_id == book_id).delete()
    for index, unit in enumerate(units):
        db.add(
            Chapter(
                id=generate(),
                book_id=book_id,
                position=index + 1,
                title=unit.title,
                content=unit.content,
                word_count=count_words(unit.content),
                group_index=unit.group_index,
            )
        )
    if book.status == "rejected":
        book.status = "draft"
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "chapter_count": len(units)}


def _chapter_fallback_name(chapter: Chapter, index: int) -> str:
    title = (chapter.title or "").strip()
    if " · " in title:
        for piece in title.split(" · "):
            piece = piece.strip()
            if not piece:
                continue
            lower = piece.lower()
            if lower.startswith("part ") or lower.startswith("phần "):
                continue
            return piece
    for line in (chapter.content or "").splitlines():
        cleaned = line.strip()
        if cleaned and cleaned != "(Empty segment)":
            return cleaned[:48]
    return f"Segment {index + 1}"


@router.post("/{book_id}/segment-titles")
async def apply_segment_titles(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
    body: Annotated[SegmentTitlesBody | None, Body()] = None,
):
    """Rename existing chapters using title format (+ optional AI names). Does not re-split."""
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    _assert_editable(book)

    chapters = (
        db.query(Chapter)
        .filter(Chapter.book_id == book_id)
        .order_by(Chapter.position.asc())
        .all()
    )
    if not chapters:
        raise HTTPException(status_code=400, detail="Split the manuscript into segments first.")

    components = normalize_title_components(
        (body.title_components if body else None) or ["part"]
    )
    assert components is not None
    language = normalize_suggest_language(body.title_language if body else "en")

    distinctive_names: list[str] | None = None
    if "name" in components:
        settings = get_settings()
        if gemini_available(settings):
            try:
                distinctive_names = await suggest_segment_names(
                    settings=settings,
                    book_title=book.title,
                    segments=[{"sample": (c.content or "")[:1200]} for c in chapters],
                    language=language,
                )
            except RuntimeError:
                distinctive_names = None

    for index, chapter in enumerate(chapters):
        name = ""
        if distinctive_names and index < len(distinctive_names):
            name = (distinctive_names[index] or "").strip()
        if not name and "name" in components:
            name = _chapter_fallback_name(chapter, index)
        chapter.title = format_segment_title(
            components=components,
            book_title=book.title,
            distinctive_name=name,
            part_index=index + 1,
            language=language,
        )

    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "chapter_count": len(chapters)}


@router.post("/{book_id}/submit-review")
def submit_review(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    book = (
        db.query(Book)
        .options(joinedload(Book.category))
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    require_current_legal_acceptance(user)
    if book.status not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Only draft or rejected books can be submitted.")
    if not book.category_id:
        raise HTTPException(status_code=400, detail="Choose a category before submitting.")
    chapter_count = (
        db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book_id)) or 0
    )
    if chapter_count == 0:
        raise HTTPException(status_code=400, detail="Split chapters before submitting for review.")

    now = datetime.now(timezone.utc)
    previous_status = book.status
    book.status = "pending_review"
    book.submitted_at = now
    book.reviewed_at = None
    book.reviewed_by = None
    book.review_note = None
    book.updated_at = now
    record_moderation_event(
        db,
        book=book,
        actor=user,
        action="submit_review",
        from_status=previous_status,
        to_status="pending_review",
    )
    db.commit()
    return {"ok": True, "status": book.status}


@router.post("/{book_id}/publish")
def publish_book_legacy(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    """Backward-compatible alias — authors now submit for review instead of self-publishing."""
    return submit_review(book_id, db, user)


@router.post("/{book_id}/purchase")
def purchase_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    book = db.get(Book, book_id)
    if not book or not _is_publicly_visible(book):
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.price_cents <= 0:
        raise HTTPException(status_code=400, detail="This book is free.")
    if book.publisher_id == user.id or _has_purchase(db, user.id, book.id):
        return {"ok": True, "alreadyOwned": True}

    purchase = Purchase(
        id=generate(),
        user_id=user.id,
        book_id=book.id,
        amount_cents=book.price_cents,
        created_at=datetime.now(timezone.utc),
    )
    db.add(purchase)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "alreadyOwned": True}

    return {"ok": True, "mock": True, "amount_cents": book.price_cents}


@router.post("/{book_id}/report")
def report_book(
    book_id: str,
    body: ReportBookBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    book = db.get(Book, book_id)
    if not book or not _is_publicly_visible(book):
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.publisher_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot report your own book.")
    existing = db.scalar(
        select(ContentReport.id).where(
            ContentReport.reporter_user_id == user.id,
            ContentReport.book_id == book.id,
            ContentReport.status == "open",
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="You already have an open report for this book.")

    details = body.details.strip()
    if body.reason == "other" and len(details) < 3:
        raise HTTPException(status_code=400, detail="Please describe the issue.")
    report = ContentReport(
        id=generate(),
        reporter_user_id=user.id,
        book_id=book.id,
        reason=body.reason,
        details=details[:4000],
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    db.add(report)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="You already have an open report for this book.",
        ) from exc
    return {"ok": True, "report_id": report.id}


@router.put("/{book_id}/progress")
def save_reading_progress(
    book_id: str,
    body: SaveProgressBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    book = (
        db.query(Book)
        .options(joinedload(Book.chapters))
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    is_manager = _can_manage_book(book, user)
    if not _is_publicly_visible(book) and not is_manager:
        raise HTTPException(status_code=404, detail="Book not found.")

    chapter = next((c for c in book.chapters if c.id == body.chapter_id), None)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    purchased = _has_purchase(db, user.id, book.id)
    if not is_manager and not can_access_chapter(
        book=book,
        chapter=chapter,
        user_id=user.id,
        purchased=purchased,
    ):
        raise HTTPException(
            status_code=402,
            detail="Purchase required to save progress for this chapter.",
        )

    paragraph_index = max(0, int(body.paragraph_index))
    scroll_fraction = max(0.0, min(1.0, float(body.scroll_fraction)))
    now = datetime.now(timezone.utc)

    chapters = sorted(book.chapters, key=lambda c: c.position)
    is_last_chapter = bool(chapters) and chapters[-1].id == chapter.id
    if body.completed is True and not is_last_chapter:
        raise HTTPException(
            status_code=400,
            detail="Only the last chapter can mark a book completed.",
        )

    row = (
        db.query(ReadingProgress)
        .filter(ReadingProgress.user_id == user.id, ReadingProgress.book_id == book.id)
        .one_or_none()
    )
    if row:
        row.chapter_id = chapter.id
        row.chapter_position = chapter.position
        row.paragraph_index = paragraph_index
        row.scroll_fraction = scroll_fraction
        row.updated_at = now
        if body.completed is True:
            row.completed_at = now
        elif body.completed is False:
            row.completed_at = None
    else:
        row = ReadingProgress(
            id=generate(),
            user_id=user.id,
            book_id=book.id,
            chapter_id=chapter.id,
            chapter_position=chapter.position,
            paragraph_index=paragraph_index,
            scroll_fraction=scroll_fraction,
            completed_at=now if body.completed is True else None,
            updated_at=now,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "progress": {
            "chapter_id": chapter.id,
            "paragraph_index": row.paragraph_index,
            "scroll_fraction": row.scroll_fraction,
            "updated_at": row.updated_at.isoformat(),
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        },
    }


@router.get("/{book_id}/chapters/{chapter_id}")
def get_chapter(
    book_id: str,
    chapter_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    book = (
        db.query(Book)
        .options(joinedload(Book.publisher), joinedload(Book.chapters))
        .filter(Book.id == book_id)
        .one_or_none()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    is_manager = _can_manage_book(book, user)
    if not _is_publicly_visible(book) and not is_manager:
        raise HTTPException(status_code=404, detail="Book not found.")

    chapter = next((c for c in book.chapters if c.id == chapter_id), None)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    purchased = bool(user and _has_purchase(db, user.id, book.id))
    user_id = user.id if user else None

    def allowed(item: Chapter) -> bool:
        if is_manager:
            return True
        return can_access_chapter(
            book=book,
            chapter=item,
            user_id=user_id,
            purchased=purchased,
        )

    chapters = [
        _chapter_list_item(item, locked=not allowed(item))
        for item in sorted(book.chapters, key=lambda c: c.position)
    ]

    if not allowed(chapter):
        return JSONResponse(
            status_code=402,
            content={
                "error": "Purchase required to read this chapter.",
                "locked": True,
                "book": {
                    "id": book.id,
                    "title": book.title,
                    "price_cents": book.price_cents,
                },
                "chapters": chapters,
            },
        )

    return {
        "book": {
            "id": book.id,
            "title": book.title,
            "price_cents": book.price_cents,
            "publisher_name": book.publisher.name,
            "publisher_handle": book.publisher.handle if book.publisher else None,
        },
        "chapter": {
            "id": chapter.id,
            "position": chapter.position,
            "title": chapter.title,
            "content": chapter.content,
            "word_count": chapter.word_count,
        },
        "chapters": chapters,
        "progress": _progress_payload(
            db,
            book=book,
            user=user,
            purchased=purchased,
            is_manager=is_manager,
        ),
    }


@router.post("/{book_id}/chapters/{chapter_id}/audio")
def prepare_chapter_audio(
    book_id: str,
    chapter_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    book, chapter = _accessible_chapter(
        db,
        book_id=book_id,
        chapter_id=chapter_id,
        user=user,
    )
    settings = get_settings()
    active = get_active_tts(db)
    voice = active.voice
    glossary_voices, glossary_presence = _glossary_voice_map(
        db,
        book.id,
        engine=active.engine,
        narrator_voice=voice,
        max_voices=active.max_character_voices,
    )
    segments = tts.chapter_audio_segments(
        chapter.content,
        voice,
        engine=active.engine,
        glossary_voices=glossary_voices,
        glossary_presence=glossary_presence,
        narrator_gender=active.gender,
        style=active.narration_style(),
    )
    if not segments:
        raise HTTPException(status_code=400, detail="This chapter has no readable text.")

    was_cached = all(tts.cache_path(settings, segment).is_file() for segment in segments)
    if not was_cached and not settings.google_tts_enabled:
        raise HTTPException(status_code=503, detail="Cloud narration is not configured.")

    if not was_cached:
        try:
            tts.prepare_segments(settings, segments, voice)
        except (DefaultCredentialsError, GoogleAPICallError, OSError) as exc:
            logger.exception("Could not prepare narration for chapter %s", chapter.id)
            raise HTTPException(
                status_code=503,
                detail="Cloud narration is temporarily unavailable.",
            ) from exc

    return {
        "engine": active.engine,
        "gender": active.gender,
        "voice": voice,
        "cache_hit": was_cached,
        "segments": [
            {
                "index": segment.index,
                "paragraph_index": segment.paragraph_index,
                "kind": segment.kind,
                "speaker": segment.speaker,
                "voice": segment.voice,
                "url": (
                    f"/api/books/{book_id}/chapters/{chapter_id}/audio/"
                    f"{segment.index}?v={segment.cache_key[:16]}"
                ),
            }
            for segment in segments
        ],
    }


@router.get("/{book_id}/chapters/{chapter_id}/audio/{segment_index}")
def get_chapter_audio_segment(
    book_id: str,
    chapter_id: str,
    segment_index: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    book, chapter = _accessible_chapter(
        db,
        book_id=book_id,
        chapter_id=chapter_id,
        user=user,
    )
    settings = get_settings()
    active = get_active_tts(db)
    voice = active.voice
    glossary_voices, glossary_presence = _glossary_voice_map(
        db,
        book.id,
        engine=active.engine,
        narrator_voice=voice,
        max_voices=active.max_character_voices,
    )
    segments = tts.chapter_audio_segments(
        chapter.content,
        voice,
        engine=active.engine,
        glossary_voices=glossary_voices,
        glossary_presence=glossary_presence,
        narrator_gender=active.gender,
        style=active.narration_style(),
    )
    if segment_index < 0 or segment_index >= len(segments):
        raise HTTPException(status_code=404, detail="Audio segment not found.")
    segment = segments[segment_index]
    path = tts.cache_path(settings, segment)

    if not path.is_file():
        if not settings.google_tts_enabled:
            raise HTTPException(status_code=503, detail="Cloud narration is not configured.")
        try:
            path = tts.synthesize_segment(settings, segment, segment.voice or voice)
        except (DefaultCredentialsError, GoogleAPICallError, OSError) as exc:
            logger.exception("Could not synthesize narration segment for chapter %s", chapter.id)
            raise HTTPException(
                status_code=503,
                detail="Cloud narration is temporarily unavailable.",
            ) from exc

    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
