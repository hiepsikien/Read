"""Load a manuscript DOCX and its character glossary straight into the database.

Usage (from apps/api):

    .venv/bin/python scripts/load_book.py \
        --manuscript ~/Downloads/"S1E1C1 - Đại Lộ Đại Dương.docx" \
        --glossary ~/Downloads/"NHÂN VẬT.docx" \
        --title "Đại Lộ Đại Dương"

Re-running with the same title replaces that book's chapters and glossary.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nanoid import generate  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.categories import ensure_categories  # noqa: E402
from app.chapters import count_words, split_into_chapters  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.covers import try_extract_and_save_cover  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.glossary import aliases_to_storage, parse_glossary_docx  # noqa: E402
from app.media import clear_book_media  # noqa: E402
from app.models import Book, Chapter, ExplainCache, GlossaryEntry, User  # noqa: E402
from app.parse_docs import extract_text_from_file  # noqa: E402


def get_or_create_publisher(db: Session, email: str, name: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        if user.role == "reader":
            user.role = "publisher"
        return user

    from app.handles import normalize_handle

    user_id = generate()
    base = normalize_handle(email.split("@")[0]) or "publisher"
    if len(base) < 3:
        base = f"{base}pub"
    handle = base[:30]
    suffix = 0
    while db.scalar(select(User).where(User.handle == handle)):
        suffix += 1
        stem = base[: max(1, 30 - len(str(suffix)) - 1)]
        handle = f"{stem}{suffix}"

    user = User(
        id=user_id,
        firebase_uid=f"dev-{user_id}",
        email=email,
        name=name,
        handle=handle,
        role="publisher",
        password_hash=hash_password("publisher123"),
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.flush()
    return user


def load_manuscript(
    db: Session,
    *,
    publisher: User,
    manuscript: Path,
    title: str,
    description: str,
    category_slug: str,
    price_cents: int,
    split_length: str,
) -> Book:
    settings = get_settings()
    categories = ensure_categories(db)
    category = next(
        (item for item in categories if item.slug == category_slug), categories[0]
    )

    book = db.scalar(
        select(Book).where(Book.publisher_id == publisher.id, Book.title == title)
    )
    now = datetime.now(timezone.utc)
    if book is None:
        book = Book(
            id=generate(),
            publisher_id=publisher.id,
            category_id=category.id,
            title=title,
            description=description,
            status="draft",
            created_at=now,
            updated_at=now,
        )
        db.add(book)
        db.flush()

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{book.id}.docx"
    (upload_dir / stored_name).write_bytes(manuscript.read_bytes())

    clear_book_media(upload_dir, book.id)
    raw_text = extract_text_from_file(
        upload_dir / stored_name,
        manuscript.name,
        media_dir=upload_dir,
        book_id=book.id,
    )

    book.category_id = category.id
    book.description = description
    book.price_cents = price_cents
    book.status = "published"
    book.source_filename = manuscript.name
    book.source_path = stored_name
    book.raw_text = raw_text
    book.cover_path = (
        try_extract_and_save_cover(upload_dir, book.id, upload_dir / stored_name)
        or book.cover_path
    )
    book.updated_at = now

    units = split_into_chapters(raw_text, preserve_paragraphs=True, length=split_length)
    if not units:
        raise SystemExit("Could not split the manuscript into chapters.")

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

    print(f"  manuscript: {len(units)} reading segments from {manuscript.name}")
    return book


def load_glossary(db: Session, *, book: Book, glossary: Path) -> int:
    parsed = parse_glossary_docx(glossary)
    if not parsed:
        raise SystemExit(f"No character entries found in {glossary.name}.")

    now = datetime.now(timezone.utc)
    db.execute(delete(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    db.execute(delete(ExplainCache).where(ExplainCache.book_id == book.id))

    for item in parsed:
        db.add(
            GlossaryEntry(
                id=generate(),
                book_id=book.id,
                episode_key=item.episode_key,
                episode_title=item.episode_title,
                group_label=item.group_label,
                name=item.name,
                aliases=aliases_to_storage(item.aliases),
                summary=item.summary,
                sort_key=item.sort_key,
                created_at=now,
                updated_at=now,
            )
        )

    episodes = sorted({item.episode_key for item in parsed if item.episode_key})
    print(f"  glossary: {len(parsed)} characters across {len(episodes)} episodes")
    print(f"  episodes: {', '.join(episodes) or 'none'}")
    return len(parsed)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manuscript", required=True, type=Path)
    parser.add_argument("--glossary", required=True, type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--category", default="fiction")
    parser.add_argument("--price-cents", type=int, default=0)
    parser.add_argument("--split-length", default="standard")
    parser.add_argument("--publisher-email", default="publisher@read.app")
    parser.add_argument("--publisher-name", default="Read Studio")
    args = parser.parse_args()

    for path in (args.manuscript, args.glossary):
        if not path.is_file():
            raise SystemExit(f"File not found: {path}")

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        publisher = get_or_create_publisher(db, args.publisher_email, args.publisher_name)
        print(f"publisher: {publisher.email}")

        book = load_manuscript(
            db,
            publisher=publisher,
            manuscript=args.manuscript,
            title=args.title,
            description=args.description,
            category_slug=args.category,
            price_cents=args.price_cents,
            split_length=args.split_length,
        )
        load_glossary(db, book=book, glossary=args.glossary)
        db.commit()
        print(f"\nPublished '{book.title}' (id {book.id}).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
