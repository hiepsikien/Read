import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

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
from ..chapters import SPLIT_PROFILES, count_words, split_into_chapters
from ..config import get_settings
from ..db import get_db
from ..legal import require_current_legal_acceptance
from ..models import Book, Category, Chapter, ContentReport, Purchase, User
from ..moderation import record_moderation_event
from ..covers import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_EXT,
    cover_absolute_path,
    cover_url_for,
    save_cover_bytes,
    try_extract_and_save_cover,
)
from ..parse_docs import extract_text_from_file
from ..tts_settings import get_active_tts
from .. import tts

logger = logging.getLogger(__name__)

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


class SplitBookBody(BaseModel):
    length: Literal["short", "standard", "long"] = "standard"


class ReportBookBody(BaseModel):
    reason: Literal["copyright", "inappropriate", "spam", "misleading", "other"]
    details: str = ""


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


def _book_list_item(book: Book, *, chapter_count: int, publisher_name: str | None = None) -> dict:
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
    if publisher_name is not None:
        item["publisher_name"] = publisher_name
    if book.publisher_id:
        item["publisher_id"] = book.publisher_id
    if book.source_filename is not None:
        item["source_filename"] = book.source_filename
    return item


def _owned(book: Book, user: User | None, purchased: bool) -> bool:
    if not user:
        return book.price_cents == 0
    if book.publisher_id == user.id or book.price_cents == 0 or user.role == "admin":
        return True
    return purchased


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
            .options(joinedload(Book.category))
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
        .options(joinedload(Book.category), joinedload(Book.publisher))
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
    ensure_categories(db)
    title = title.strip()
    description = description.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    category = _get_category(db, category_id.strip() or None)
    if not category:
        raise HTTPException(status_code=400, detail="Category is required.")
    if not file.filename:
        raise HTTPException(status_code=400, detail="A DOCX manuscript is required.")

    original_name = file.filename
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
        raw_text = extract_text_from_file(stored_path, original_name if original_name.lower().endswith(".docx") else f"{original_name}.docx")
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
    return {
        "book": {
            "id": book.id,
            "title": book.title,
            "description": book.description,
            "price_cents": book.price_cents,
            "status": book.status,
            "featured": book.featured,
            "visibility": book.visibility,
            "publisher_name": book.publisher.name,
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
        "chapters": [_chapter_list_item(c) for c in chapters],
        "access": {
            "owned": _owned(book, user, purchased),
            "isPublisherOwner": bool(user and user.id == book.publisher_id),
            "previewChapterId": chapters[0].id if chapters else None,
        },
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
        headers={"Cache-Control": "public, max-age=86400"},
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
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "status": book.status}


@router.post("/{book_id}/split")
def split_book(
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

    units = split_into_chapters(
        book.raw_text or "", preserve_paragraphs=True, length=length
    )
    if not units:
        raise HTTPException(status_code=400, detail="Could not create chapters from this document.")

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
        },
        "chapter": {
            "id": chapter.id,
            "position": chapter.position,
            "title": chapter.title,
            "content": chapter.content,
            "word_count": chapter.word_count,
        },
        "chapters": chapters,
    }


@router.post("/{book_id}/chapters/{chapter_id}/audio")
def prepare_chapter_audio(
    book_id: str,
    chapter_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    _book, chapter = _accessible_chapter(
        db,
        book_id=book_id,
        chapter_id=chapter_id,
        user=user,
    )
    settings = get_settings()
    active = get_active_tts(db)
    voice = active.voice
    segments = tts.chapter_audio_segments(chapter.content, voice)
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
    _book, chapter = _accessible_chapter(
        db,
        book_id=book_id,
        chapter_id=chapter_id,
        user=user,
    )
    settings = get_settings()
    voice = get_active_tts(db).voice
    segments = tts.chapter_audio_segments(chapter.content, voice)
    if segment_index < 0 or segment_index >= len(segments):
        raise HTTPException(status_code=404, detail="Audio segment not found.")
    segment = segments[segment_index]
    path = tts.cache_path(settings, segment)

    if not path.is_file():
        if not settings.google_tts_enabled:
            raise HTTPException(status_code=503, detail="Cloud narration is not configured.")
        try:
            path = tts.synthesize_segment(settings, segment, voice)
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
