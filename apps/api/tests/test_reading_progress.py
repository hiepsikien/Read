from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from nanoid import generate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password, mint_dev_id_token
from app.categories import ensure_categories
from app.db import Base, get_db
from app.legal import CURRENT_LEGAL_VERSION
from app.main import app
from app.models import Book, Chapter, ReadingProgress, User


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded(db_session):
    categories = ensure_categories(db_session)
    now = datetime.now(timezone.utc)
    publisher = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="author@example.com",
        name="Author",
        role="publisher",
        password_hash=hash_password("password123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    reader = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="reader@example.com",
        name="Reader",
        role="reader",
        password_hash=hash_password("reader123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    db_session.add_all([publisher, reader])
    db_session.commit()

    fiction = next(c for c in categories if c.slug == "fiction")
    free_book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Free Book",
        description="A free story",
        price_cents=0,
        status="published",
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    paid_book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Paid Book",
        description="A paid story",
        price_cents=499,
        status="published",
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([free_book, paid_book])
    db_session.flush()

    free_chapters = []
    for index in range(1, 4):
        chapter = Chapter(
            id=generate(),
            book_id=free_book.id,
            position=index,
            title=f"Free Chapter {index}",
            content=f"Paragraph one of chapter {index}.\n\nParagraph two.",
            word_count=10,
            group_index=index,
        )
        free_chapters.append(chapter)
        db_session.add(chapter)

    paid_preview = Chapter(
        id=generate(),
        book_id=paid_book.id,
        position=1,
        title="Preview",
        content="Free preview segment.",
        word_count=3,
        group_index=1,
    )
    paid_locked = Chapter(
        id=generate(),
        book_id=paid_book.id,
        position=2,
        title="Locked",
        content="Paid segment.",
        word_count=2,
        group_index=2,
    )
    db_session.add_all([paid_preview, paid_locked])
    db_session.commit()

    return {
        "publisher": publisher,
        "reader": reader,
        "free_book": free_book,
        "paid_book": paid_book,
        "free_chapters": free_chapters,
        "paid_preview": paid_preview,
        "paid_locked": paid_locked,
    }


def auth_header(user: User) -> dict[str, str]:
    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"Authorization": f"Bearer {token}"}


def test_anonymous_put_progress_requires_auth(client, seeded):
    book = seeded["free_book"]
    chapter = seeded["free_chapters"][1]
    response = client.put(
        f"/api/books/{book.id}/progress",
        json={"chapter_id": chapter.id, "paragraph_index": 1, "scroll_fraction": 0.4},
    )
    assert response.status_code == 401


def test_save_progress_appears_on_book_and_chapter(client, seeded):
    reader = seeded["reader"]
    book = seeded["free_book"]
    chapter = seeded["free_chapters"][1]
    headers = auth_header(reader)

    saved = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={
            "chapter_id": chapter.id,
            "paragraph_index": 1,
            "scroll_fraction": 0.42,
        },
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["ok"] is True
    assert body["progress"]["chapter_id"] == chapter.id
    assert body["progress"]["paragraph_index"] == 1
    assert abs(body["progress"]["scroll_fraction"] - 0.42) < 1e-6

    detail = client.get(f"/api/books/{book.id}", headers=headers)
    assert detail.status_code == 200
    progress = detail.json()["access"]["progress"]
    assert progress is not None
    assert progress["chapter_id"] == chapter.id
    assert progress["paragraph_index"] == 1

    chapter_payload = client.get(
        f"/api/books/{book.id}/chapters/{chapter.id}",
        headers=headers,
    )
    assert chapter_payload.status_code == 200
    assert chapter_payload.json()["progress"]["chapter_id"] == chapter.id


def test_locked_paid_chapter_progress_rejected(client, seeded):
    reader = seeded["reader"]
    book = seeded["paid_book"]
    locked = seeded["paid_locked"]
    response = client.put(
        f"/api/books/{book.id}/progress",
        headers=auth_header(reader),
        json={"chapter_id": locked.id, "paragraph_index": 0, "scroll_fraction": 0.1},
    )
    assert response.status_code == 402


def test_progress_upsert_keeps_single_row(client, seeded, db_session):
    reader = seeded["reader"]
    book = seeded["free_book"]
    first = seeded["free_chapters"][0]
    second = seeded["free_chapters"][2]
    headers = auth_header(reader)

    first_save = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={"chapter_id": first.id, "paragraph_index": 0, "scroll_fraction": 0.1},
    )
    assert first_save.status_code == 200

    second_save = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={"chapter_id": second.id, "paragraph_index": 2, "scroll_fraction": 0.8},
    )
    assert second_save.status_code == 200
    assert second_save.json()["progress"]["chapter_id"] == second.id

    rows = (
        db_session.query(ReadingProgress)
        .filter(ReadingProgress.user_id == reader.id, ReadingProgress.book_id == book.id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].chapter_id == second.id
    assert rows[0].paragraph_index == 2


def test_progress_falls_back_to_chapter_position_after_delete(client, seeded, db_session):
    reader = seeded["reader"]
    book = seeded["free_book"]
    chapter = seeded["free_chapters"][1]
    headers = auth_header(reader)

    saved = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={"chapter_id": chapter.id, "paragraph_index": 1, "scroll_fraction": 0.5},
    )
    assert saved.status_code == 200

    old_position = chapter.position
    db_session.delete(chapter)
    db_session.commit()

    row = (
        db_session.query(ReadingProgress)
        .filter(ReadingProgress.user_id == reader.id, ReadingProgress.book_id == book.id)
        .one()
    )
    # SQLite may not enforce ON DELETE SET NULL unless PRAGMA foreign_keys=ON.
    # Mimic the production FK behavior for the resolution test.
    if row.chapter_id is not None:
        row.chapter_id = None
        db_session.commit()

    # Recreate a chapter at the same position with a new id.
    replacement = Chapter(
        id=generate(),
        book_id=book.id,
        position=old_position,
        title="Replacement",
        content="New content.",
        word_count=2,
        group_index=old_position,
    )
    db_session.add(replacement)
    db_session.commit()

    detail = client.get(f"/api/books/{book.id}", headers=headers)
    assert detail.status_code == 200
    progress = detail.json()["access"]["progress"]
    assert progress is not None
    assert progress["chapter_id"] == replacement.id
    assert progress["paragraph_index"] == 1


def test_complete_and_list_reading_shelf(client, seeded, db_session):
    reader = seeded["reader"]
    book = seeded["free_book"]
    first = seeded["free_chapters"][0]
    last = seeded["free_chapters"][-1]
    headers = auth_header(reader)

    mid = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={"chapter_id": first.id, "paragraph_index": 0, "scroll_fraction": 0.2},
    )
    assert mid.status_code == 200
    assert mid.json()["progress"].get("completed_at") is None

    shelf = client.get("/api/reading", headers=headers)
    assert shelf.status_code == 200
    items = shelf.json()["items"]
    assert len(items) == 1
    assert items[0]["book"]["id"] == book.id
    assert items[0]["progress"]["chapter_id"] == first.id
    assert items[0]["progress"]["chapter_title"]
    assert items[0]["progress"]["chapter_count"] >= 1

    bad = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={
            "chapter_id": first.id,
            "paragraph_index": 0,
            "scroll_fraction": 1,
            "completed": True,
        },
    )
    assert bad.status_code == 400

    done = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={
            "chapter_id": last.id,
            "paragraph_index": 0,
            "scroll_fraction": 1,
            "completed": True,
        },
    )
    assert done.status_code == 200
    assert done.json()["progress"]["completed_at"] is not None

    empty = client.get("/api/reading", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["items"] == []

    restart = client.put(
        f"/api/books/{book.id}/progress",
        headers=headers,
        json={
            "chapter_id": first.id,
            "paragraph_index": 0,
            "scroll_fraction": 0,
            "completed": False,
        },
    )
    assert restart.status_code == 200
    assert restart.json()["progress"]["completed_at"] is None

    again = client.get("/api/reading", headers=headers)
    assert again.status_code == 200
    assert len(again.json()["items"]) == 1


def test_list_reading_requires_auth(client):
    assert client.get("/api/reading").status_code == 401


def test_list_reading_skips_removed_even_for_publisher(client, db_session, seeded):
    publisher = seeded["publisher"]
    now = datetime.now(timezone.utc)
    category_id = seeded["free_book"].category_id
    listed = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=category_id,
        title="S1E2 Listed",
        description="",
        price_cents=0,
        status="published",
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    # Same title pattern as a re-upload that was taken down.
    removed = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=category_id,
        title="S1E2 Removed",
        description="",
        price_cents=0,
        status="published",
        visibility="removed",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([listed, removed])
    db_session.flush()
    listed_ch = Chapter(
        id=generate(),
        book_id=listed.id,
        position=1,
        title="Ch 1",
        content="Hello.",
        word_count=1,
        group_index=1,
    )
    removed_ch = Chapter(
        id=generate(),
        book_id=removed.id,
        position=1,
        title="Ch 1",
        content="Hello.",
        word_count=1,
        group_index=1,
    )
    db_session.add_all([listed_ch, removed_ch])
    db_session.add_all(
        [
            ReadingProgress(
                id=generate(),
                user_id=publisher.id,
                book_id=listed.id,
                chapter_id=listed_ch.id,
                chapter_position=1,
                paragraph_index=0,
                scroll_fraction=0.2,
                updated_at=now,
            ),
            ReadingProgress(
                id=generate(),
                user_id=publisher.id,
                book_id=removed.id,
                chapter_id=removed_ch.id,
                chapter_position=1,
                paragraph_index=0,
                scroll_fraction=0.5,
                updated_at=now,
            ),
        ]
    )
    db_session.commit()

    shelf = client.get("/api/reading", headers=auth_header(publisher))
    assert shelf.status_code == 200
    ids = [item["book"]["id"] for item in shelf.json()["items"]]
    assert listed.id in ids
    assert removed.id not in ids
