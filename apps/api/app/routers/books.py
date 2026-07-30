from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from nanoid import generate
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..access import can_access_chapter
from ..auth import get_current_user, get_current_user_optional, require_publisher
from ..chapters import count_words, split_into_chapters
from ..config import get_settings
from ..db import get_db
from ..models import Book, Chapter, Purchase, User
from ..parse_docs import extract_text_from_file

router = APIRouter(prefix="/api/books", tags=["books"])


class PatchBookBody(BaseModel):
    title: str | None = None
    description: str | None = None
    pricing: str | None = None
    price: float | None = None


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


def _owned(book: Book, user: User | None, purchased: bool) -> bool:
    if not user:
        return book.price_cents == 0
    if book.publisher_id == user.id or book.price_cents == 0:
        return True
    return purchased


def _has_purchase(db: Session, user_id: str, book_id: str) -> bool:
    row = db.scalar(
        select(Purchase.id).where(Purchase.user_id == user_id, Purchase.book_id == book_id)
    )
    return bool(row)


@router.get("")
def list_books(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
    mine: int = 0,
):
    if mine == 1:
        if not user or user.role != "publisher":
            raise HTTPException(status_code=403, detail="Publisher login required.")
        books = (
            db.query(Book)
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
            result.append(
                {
                    "id": book.id,
                    "title": book.title,
                    "description": book.description,
                    "price_cents": book.price_cents,
                    "status": book.status,
                    "chapter_count": chapter_count,
                    "created_at": book.created_at.isoformat(),
                    "updated_at": book.updated_at.isoformat(),
                    "publisher_id": book.publisher_id,
                    "source_filename": book.source_filename,
                }
            )
        return {"books": result}

    rows = (
        db.query(Book, User.name)
        .join(User, User.id == Book.publisher_id)
        .filter(Book.status == "published")
        .order_by(Book.created_at.desc())
        .all()
    )
    books = []
    for book, publisher_name in rows:
        chapter_count = (
            db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book.id))
            or 0
        )
        books.append(
            {
                "id": book.id,
                "title": book.title,
                "description": book.description,
                "price_cents": book.price_cents,
                "status": book.status,
                "publisher_name": publisher_name,
                "chapter_count": chapter_count,
                "created_at": book.created_at.isoformat(),
            }
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
    file: UploadFile = File(...),
):
    settings = get_settings()
    title = title.strip()
    description = description.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    if not file.filename:
        raise HTTPException(status_code=400, detail="A PDF or DOCX file is required.")

    original_name = file.filename
    ext = Path(original_name).suffix.lower()
    if ext not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported.")

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
        raw_text = extract_text_from_file(stored_path, original_name)
    except Exception as exc:  # noqa: BLE001
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    book = Book(
        id=book_id,
        publisher_id=user.id,
        title=title,
        description=description,
        price_cents=price_cents,
        status="draft",
        source_filename=original_name,
        source_path=stored_name,
        raw_text=raw_text,
        created_at=now,
        updated_at=now,
    )
    db.add(book)
    db.commit()
    return {"id": book_id}


@router.get("/{book_id}")
def get_book(
    book_id: str,
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

    is_publisher_owner = bool(user and user.id == book.publisher_id)
    if book.status != "published" and not is_publisher_owner:
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
            "publisher_name": book.publisher.name,
            "publisher_id": book.publisher_id,
            "source_filename": book.source_filename,
            "created_at": book.created_at.isoformat(),
            "updated_at": book.updated_at.isoformat(),
            "has_raw_text": bool(book.raw_text),
        },
        "chapters": [_chapter_list_item(c) for c in chapters],
        "access": {
            "owned": _owned(book, user, purchased),
            "isPublisherOwner": is_publisher_owner,
            "previewChapterId": chapters[0].id if chapters else None,
        },
    }


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

    title = body.title.strip() if body.title is not None else book.title
    description = body.description.strip() if body.description is not None else book.description
    price_cents = book.price_cents

    if body.pricing == "free":
        price_cents = 0
    elif body.pricing == "paid" or body.price is not None:
        dollars = body.price if body.price is not None else price_cents / 100
        price_cents = max(1, round((dollars if dollars == dollars else 1) * 100))

    book.title = title
    book.description = description
    book.price_cents = price_cents
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.post("/{book_id}/split")
def split_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if not (book.raw_text or "").strip():
        raise HTTPException(status_code=400, detail="No extracted text available to split.")

    units = split_into_chapters(book.raw_text or "")
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
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "chapter_count": len(units)}


@router.post("/{book_id}/publish")
def publish_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    book = db.get(Book, book_id)
    if not book or book.publisher_id != user.id:
        raise HTTPException(status_code=404, detail="Book not found.")

    chapter_count = (
        db.scalar(select(func.count()).select_from(Chapter).where(Chapter.book_id == book_id)) or 0
    )
    if chapter_count == 0:
        raise HTTPException(status_code=400, detail="Split chapters before publishing.")

    book.status = "published"
    book.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "status": "published"}


@router.post("/{book_id}/purchase")
def purchase_book(
    book_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    book = db.get(Book, book_id)
    if not book or book.status != "published":
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

    is_publisher_owner = bool(user and user.id == book.publisher_id)
    if book.status != "published" and not is_publisher_owner:
        raise HTTPException(status_code=404, detail="Book not found.")

    chapter = next((c for c in book.chapters if c.id == chapter_id), None)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    purchased = bool(user and _has_purchase(db, user.id, book.id))
    user_id = user.id if user else None

    def allowed(item: Chapter) -> bool:
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
