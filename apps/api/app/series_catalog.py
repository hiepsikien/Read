"""Helpers for Series → Season → Episode (Book) catalog placement."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .covers import cover_url_for
from .credits import credits_payload
from .models import Book, ReadingProgress, Series


def series_ref(series: Series | None, *, for_public: bool = False) -> dict | None:
    if not series:
        return None
    if for_public and getattr(series, "visibility", "listed") != "listed":
        return None
    return {"id": series.id, "title": series.title}


def clear_series_episodes(db: Session, series_id: str) -> int:
    """Unassign all episodes from a series. Returns number of books cleared."""
    books = db.scalars(select(Book).where(Book.series_id == series_id)).all()
    for book in books:
        book.series_id = None
        book.season_number = None
        book.episode_number = None
    return len(books)


def apply_series_placement(
    db: Session,
    book: Book,
    *,
    series_id: str | None,
    season_number: int | None,
    episode_number: int | None,
    clear_series: bool,
) -> None:
    if clear_series:
        book.series_id = None
        book.season_number = None
        book.episode_number = None
        return

    if series_id is None and season_number is None and episode_number is None:
        return

    target_series_id = series_id if series_id is not None else book.series_id
    target_season = season_number if season_number is not None else book.season_number
    target_episode = episode_number if episode_number is not None else book.episode_number

    if not target_series_id:
        raise HTTPException(status_code=400, detail="series_id is required to place an episode.")
    if target_season is None or target_episode is None:
        raise HTTPException(
            status_code=400,
            detail="season_number and episode_number are required when placing in a series.",
        )
    if target_season < 1 or target_episode < 1:
        raise HTTPException(
            status_code=400,
            detail="season_number and episode_number must be at least 1.",
        )

    series = db.get(Series, target_series_id)
    if not series or series.publisher_id != book.publisher_id:
        raise HTTPException(status_code=400, detail="Series not found for this publisher.")

    conflict = db.scalar(
        select(Book.id).where(
            Book.series_id == target_series_id,
            Book.season_number == target_season,
            Book.episode_number == target_episode,
            Book.id != book.id,
        )
    )
    if conflict:
        raise HTTPException(
            status_code=400,
            detail=f"S{target_season}E{target_episode} is already taken in this series.",
        )

    book.series_id = target_series_id
    book.season_number = target_season
    book.episode_number = target_episode


def series_list_item(series: Series, *, episode_count: int = 0) -> dict:
    return {
        "id": series.id,
        "title": series.title,
        "description": series.description,
        "publisher_id": series.publisher_id,
        "publisher_name": series.publisher.name if series.publisher else None,
        "publisher_handle": series.publisher.handle if series.publisher else None,
        "episode_count": episode_count,
        "visibility": getattr(series, "visibility", "listed") or "listed",
        "cover_url": (
            f"/api/series/{series.id}/cover" if series.cover_path else None
        ),
        "created_at": series.created_at.isoformat(),
        "updated_at": series.updated_at.isoformat(),
    }


def attach_series_fields(item: dict, book: Book, *, for_public: bool = False) -> dict:
    item["series"] = series_ref(book.series, for_public=for_public)
    if for_public and item["series"] is None:
        item["season_number"] = None
        item["episode_number"] = None
    else:
        item["season_number"] = book.season_number
        item["episode_number"] = book.episode_number
    return item


def find_next_episode(db: Session, book: Book) -> Book | None:
    if not book.series_id or book.season_number is None or book.episode_number is None:
        return None
    series = book.series or db.get(Series, book.series_id)
    if not series or getattr(series, "visibility", "listed") != "listed":
        return None
    candidates = db.scalars(
        select(Book)
        .options(joinedload(Book.publisher), joinedload(Book.category), joinedload(Book.series))
        .where(
            Book.series_id == book.series_id,
            Book.status == "published",
            Book.visibility == "listed",
            Book.id != book.id,
        )
    ).all()
    ordered = sorted(
        [
            row
            for row in candidates
            if row.season_number is not None and row.episode_number is not None
        ],
        key=lambda row: (row.season_number, row.episode_number),
    )
    for row in ordered:
        if (row.season_number, row.episode_number) > (book.season_number, book.episode_number):
            return row
    return None


def episode_code(season_number: int | None, episode_number: int | None) -> str | None:
    if season_number is None or episode_number is None:
        return None
    return f"S{season_number}E{episode_number}"


def series_continue_targets(
    db: Session,
    *,
    user_id: str,
    incomplete_book_ids: set[str],
) -> list[tuple[Book, Book]]:
    """Return (anchor_completed_book, next_episode) for series the user should continue.

    Skips series where the user already has an in-progress episode.
    """
    completed_rows = (
        db.query(ReadingProgress)
        .join(Book, Book.id == ReadingProgress.book_id)
        .options(
            joinedload(ReadingProgress.book).joinedload(Book.publisher),
            joinedload(ReadingProgress.book).joinedload(Book.category),
            joinedload(ReadingProgress.book).joinedload(Book.series),
        )
        .filter(
            ReadingProgress.user_id == user_id,
            ReadingProgress.completed_at.is_not(None),
            Book.series_id.is_not(None),
            Book.status == "published",
            Book.visibility == "listed",
            Book.season_number.is_not(None),
            Book.episode_number.is_not(None),
        )
        .all()
    )

    best_by_series: dict[str, Book] = {}
    for row in completed_rows:
        book = row.book
        if not book or not book.series_id:
            continue
        current = best_by_series.get(book.series_id)
        if current is None or (book.season_number, book.episode_number) > (
            current.season_number,
            current.episode_number,
        ):
            best_by_series[book.series_id] = book

    incomplete_series_ids: set[str] = set()
    if incomplete_book_ids:
        for book_id in incomplete_book_ids:
            book = db.get(Book, book_id)
            if book and book.series_id:
                incomplete_series_ids.add(book.series_id)

    results: list[tuple[Book, Book]] = []
    for series_id, anchor in best_by_series.items():
        if series_id in incomplete_series_ids:
            continue
        nxt = find_next_episode(db, anchor)
        if nxt:
            results.append((anchor, nxt))

    results.sort(
        key=lambda pair: (
            pair[1].series.title.lower() if pair[1].series else "",
            pair[1].season_number or 0,
            pair[1].episode_number or 0,
        )
    )
    return results


def group_episodes_by_season(books: list[Book], *, chapter_counts: dict[str, int]) -> list[dict]:
    by_season: dict[int, list[Book]] = {}
    for book in books:
        if book.season_number is None:
            continue
        by_season.setdefault(book.season_number, []).append(book)

    seasons: list[dict] = []
    for season_number in sorted(by_season):
        episodes = sorted(
            by_season[season_number],
            key=lambda b: (b.episode_number or 0, b.created_at),
        )
        seasons.append(
            {
                "season_number": season_number,
                "episodes": [
                    attach_series_fields(
                        {
                            "id": book.id,
                            "title": book.title,
                            "description": book.description,
                            "price_cents": book.price_cents,
                            "status": book.status,
                            "featured": book.featured,
                            "visibility": book.visibility,
                            "chapter_count": chapter_counts.get(book.id, 0),
                            "created_at": book.created_at.isoformat(),
                            "updated_at": book.updated_at.isoformat(),
                            "cover_url": cover_url_for(book.id, book.cover_path),
                            "publisher_id": book.publisher_id,
                            "publisher_name": book.publisher.name if book.publisher else None,
                            "publisher_handle": (
                                book.publisher.handle if book.publisher else None
                            ),
                            **credits_payload(
                                book,
                                publisher_name=book.publisher.name if book.publisher else "",
                            ),
                        },
                        book,
                    )
                    for book in episodes
                ],
            }
        )
    return seasons
