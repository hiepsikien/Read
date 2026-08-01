"""Canonicalize book.cast_overrides keys (đ→d) and drop dirty duplicates."""
from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.cast_overrides import (
    overrides_raw_needs_rewrite,
    parse_cast_overrides,
    serialize_cast_overrides,
)
from app.config import get_settings
from app.models import Book


def main() -> None:
    engine = create_engine(get_settings().database_url)
    books_changed = 0
    with Session(engine) as db:
        books = list(db.scalars(select(Book)))
        for book in books:
            raw = getattr(book, "cast_overrides", None)
            if not overrides_raw_needs_rewrite(raw):
                continue
            cleaned = parse_cast_overrides(raw)
            book.cast_overrides = serialize_cast_overrides(cleaned)
            books_changed += 1
            print(f"cleaned {book.id} {book.title!r} keys={len(cleaned)}")
        db.commit()
    print(f"done books_changed={books_changed}")


if __name__ == "__main__":
    main()
