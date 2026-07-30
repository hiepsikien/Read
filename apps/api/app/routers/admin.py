from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, joinedload

from ..auth import require_admin
from ..categories import category_payload
from ..covers import cover_url_for
from ..db import get_db
from ..models import Book, Chapter, ContentReport, ModerationEvent, User
from ..moderation import allowed_admin_actions, event_payload, record_moderation_event
from ..tts_settings import get_active_tts, tts_settings_payload, upsert_tts_settings

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


def _report_count(db: Session, book_id: str, status: str | None = "open") -> int:
    query = select(func.count()).select_from(ContentReport).where(
        ContentReport.book_id == book_id
    )
    if status:
        query = query.where(ContentReport.status == status)
    return db.scalar(query) or 0


def _queue_item(book: Book, chapter_count: int, report_count: int = 0) -> dict:
    return {
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
        "publisher_id": book.publisher_id,
        "category": category_payload(book.category),
        "source_filename": book.source_filename,
        "submitted_at": book.submitted_at.isoformat() if book.submitted_at else None,
        "created_at": book.created_at.isoformat(),
        "updated_at": book.updated_at.isoformat(),
        "review_note": book.review_note,
        "cover_url": cover_url_for(book.id, book.cover_path),
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
    return {
        "ok": True,
        "status": "published",
        "visibility": "listed",
        "featured": make_featured,
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
