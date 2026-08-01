from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user_optional, require_publisher
from ..config import get_settings
from ..covers import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_EXT,
    MAX_UPLOAD_BYTES,
    normalize_cover_image,
)
from ..db import get_db
from ..models import Book, Chapter, Series, User
from ..series_catalog import clear_series_episodes, group_episodes_by_season, series_list_item

router = APIRouter(prefix="/api/series", tags=["series"])


class CreateSeriesBody(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str = ""


class PatchSeriesBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    visibility: Literal["listed", "hidden"] | None = None


def _can_manage_series(series: Series, user: User | None) -> bool:
    if not user:
        return False
    if user.role == "admin":
        return True
    return series.publisher_id == user.id


def _chapter_counts(db: Session, book_ids: list[str]) -> dict[str, int]:
    if not book_ids:
        return {}
    rows = db.execute(
        select(Chapter.book_id, func.count())
        .where(Chapter.book_id.in_(book_ids))
        .group_by(Chapter.book_id)
    ).all()
    return {book_id: int(count) for book_id, count in rows}


def _published_episode_count(db: Session, series_id: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Book)
            .where(
                Book.series_id == series_id,
                Book.status == "published",
                Book.visibility == "listed",
            )
        )
        or 0
    )


def _series_cover_relative(series_id: str) -> str:
    return f"covers/series-{series_id}.jpg"


def _is_publicly_listed(series: Series) -> bool:
    return (getattr(series, "visibility", "listed") or "listed") == "listed"


@router.post("")
def create_series(
    body: CreateSeriesBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    now = datetime.now(timezone.utc)
    series = Series(
        id=generate(),
        publisher_id=user.id,
        title=title,
        description=(body.description or "").strip(),
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    db.add(series)
    db.commit()
    db.refresh(series)
    series.publisher = user
    return {"series": series_list_item(series, episode_count=0)}


def _all_episode_count(db: Session, series_id: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Book)
            .where(Book.series_id == series_id)
        )
        or 0
    )


@router.get("")
def list_series(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
    mine: int = 0,
    all: int = 0,
):
    query = db.query(Series).options(joinedload(Series.publisher))
    manager_list = False
    if all:
        if not user or user.role != "admin":
            raise HTTPException(status_code=403, detail="Admin only.")
        manager_list = True
    elif mine:
        if not user or user.role not in {"publisher", "admin"}:
            raise HTTPException(status_code=401, detail="Authentication required.")
        manager_list = True
        if user.role == "publisher":
            query = query.filter(Series.publisher_id == user.id)
    else:
        public_series_ids = (
            select(Book.series_id)
            .where(
                Book.series_id.is_not(None),
                Book.status == "published",
                Book.visibility == "listed",
            )
            .distinct()
        )
        query = query.filter(
            Series.id.in_(public_series_ids),
            Series.visibility == "listed",
        )

    rows = query.order_by(Series.updated_at.desc()).all()
    return {
        "series": [
            series_list_item(
                item,
                episode_count=(
                    _all_episode_count(db, item.id)
                    if manager_list
                    else _published_episode_count(db, item.id)
                ),
            )
            for item in rows
        ]
    }


@router.get("/{series_id}")
def get_series(
    series_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    series = (
        db.query(Series)
        .options(joinedload(Series.publisher))
        .filter(Series.id == series_id)
        .one_or_none()
    )
    if not series:
        raise HTTPException(status_code=404, detail="Series not found.")

    is_manager = _can_manage_series(series, user)
    if not is_manager and not _is_publicly_listed(series):
        raise HTTPException(status_code=404, detail="Series not found.")

    books_query = (
        db.query(Book)
        .options(joinedload(Book.publisher), joinedload(Book.category), joinedload(Book.series))
        .filter(Book.series_id == series.id)
    )
    if is_manager:
        books = books_query.all()
    else:
        books = books_query.filter(
            Book.status == "published",
            Book.visibility == "listed",
        ).all()
        if not books:
            raise HTTPException(status_code=404, detail="Series not found.")

    counts = _chapter_counts(db, [book.id for book in books])
    public_count = sum(
        1 for book in books if book.status == "published" and book.visibility == "listed"
    )
    return {
        "series": series_list_item(series, episode_count=public_count if not is_manager else _all_episode_count(db, series.id)),
        "seasons": group_episodes_by_season(books, chapter_counts=counts),
    }


@router.patch("/{series_id}")
def patch_series(
    series_id: str,
    body: PatchSeriesBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    series = db.get(Series, series_id)
    if not series or not _can_manage_series(series, user):
        raise HTTPException(status_code=404, detail="Series not found.")
    if series.publisher_id != user.id and user.role != "admin":
        raise HTTPException(status_code=404, detail="Series not found.")

    if body.visibility is not None:
        if user.role != "admin":
            raise HTTPException(status_code=403, detail="Admin only.")
        series.visibility = body.visibility

    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required.")
        series.title = title
    if body.description is not None:
        series.description = body.description.strip()
    series.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(series)
    if series.publisher is None:
        series.publisher = db.get(User, series.publisher_id)
    return {
        "ok": True,
        "series": series_list_item(
            series, episode_count=_all_episode_count(db, series.id)
        ),
    }


@router.delete("/{series_id}")
def delete_series(
    series_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
):
    series = db.get(Series, series_id)
    if not series or not _can_manage_series(series, user):
        raise HTTPException(status_code=404, detail="Series not found.")
    if series.publisher_id != user.id and user.role != "admin":
        raise HTTPException(status_code=404, detail="Series not found.")

    cleared = clear_series_episodes(db, series.id)
    cover_path = series.cover_path
    db.delete(series)
    db.commit()

    if cover_path:
        settings = get_settings()
        absolute = Path(settings.upload_dir) / cover_path
        try:
            if absolute.is_file():
                absolute.unlink()
        except OSError:
            pass

    return {"ok": True, "cleared_episodes": cleared}


@router.get("/{series_id}/cover")
def get_series_cover(
    series_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
):
    series = db.get(Series, series_id)
    if not series or not series.cover_path:
        raise HTTPException(status_code=404, detail="Cover not found.")

    is_manager = _can_manage_series(series, user)
    if not is_manager:
        if not _is_publicly_listed(series):
            raise HTTPException(status_code=404, detail="Cover not found.")
        has_public = db.scalar(
            select(Book.id)
            .where(
                Book.series_id == series.id,
                Book.status == "published",
                Book.visibility == "listed",
            )
            .limit(1)
        )
        if not has_public:
            raise HTTPException(status_code=404, detail="Cover not found.")

    settings = get_settings()
    path = Path(settings.upload_dir) / series.cover_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Cover not found.")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/{series_id}/cover")
async def upload_series_cover(
    series_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_publisher)],
    file: UploadFile = File(...),
):
    series = db.get(Series, series_id)
    if not series or not _can_manage_series(series, user):
        raise HTTPException(status_code=404, detail="Series not found.")
    if series.publisher_id != user.id and user.role != "admin":
        raise HTTPException(status_code=404, detail="Series not found.")

    content_type = (file.content_type or "").lower()
    filename = (file.filename or "").lower()
    ext = Path(filename).suffix
    if content_type not in ALLOWED_CONTENT_TYPES and ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Cover must be a JPEG, PNG, or WebP image.")

    raw = await file.read()
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Cover image is missing or too large.")

    settings = get_settings()
    try:
        normalized = normalize_cover_image(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not process cover image.") from exc

    relative = _series_cover_relative(series.id)
    absolute = Path(settings.upload_dir) / relative
    absolute.parent.mkdir(parents=True, exist_ok=True)
    absolute.write_bytes(normalized)
    series.cover_path = relative
    series.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "cover_url": f"/api/series/{series.id}/cover"}
