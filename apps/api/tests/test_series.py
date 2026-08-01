from datetime import datetime, timezone

import pytest
from docx import Document
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
from app.models import Book, Chapter, ReadingProgress, Series, User


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
    return {
        "publisher": publisher,
        "reader": reader,
        "fiction": next(c for c in categories if c.slug == "fiction"),
    }


def auth_header(user: User) -> dict[str, str]:
    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"Authorization": f"Bearer {token}"}


def _make_docx(path: str, paragraphs: list[str]) -> None:
    doc = Document()
    for text in paragraphs:
        doc.add_paragraph(text)
    doc.save(path)


def _create_published_episode(
    db_session,
    *,
    publisher: User,
    category_id: str,
    title: str,
    series_id: str | None = None,
    season_number: int | None = None,
    episode_number: int | None = None,
) -> Book:
    now = datetime.now(timezone.utc)
    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=category_id,
        series_id=series_id,
        season_number=season_number,
        episode_number=episode_number,
        title=title,
        description=f"Desc for {title}",
        price_cents=499,
        status="published",
        visibility="listed",
        cast_status="draft",
        cast_overrides="{}",
        created_at=now,
        updated_at=now,
    )
    db_session.add(book)
    db_session.flush()
    db_session.add(
        Chapter(
            id=generate(),
            book_id=book.id,
            position=1,
            title="Part 1",
            content="Hello world.",
            word_count=2,
            group_index=1,
        )
    )
    db_session.commit()
    return book


def test_create_series_and_attach_episodes(client, db_session, seeded, tmp_path):
    publisher = seeded["publisher"]
    headers = auth_header(publisher)

    created = client.post(
        "/api/series",
        headers=headers,
        json={"title": "City Walls", "description": "A long serial."},
    )
    assert created.status_code == 200
    series_id = created.json()["series"]["id"]
    assert created.json()["series"]["title"] == "City Walls"

    e1 = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="S1E1",
    )
    e2 = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="S1E2",
    )

    attach1 = client.patch(
        f"/api/books/{e1.id}",
        headers=headers,
        json={"series_id": series_id, "season_number": 1, "episode_number": 1},
    )
    assert attach1.status_code == 200

    attach2 = client.patch(
        f"/api/books/{e2.id}",
        headers=headers,
        json={"series_id": series_id, "season_number": 1, "episode_number": 2},
    )
    assert attach2.status_code == 200

    conflict = client.patch(
        f"/api/books/{e2.id}",
        headers=headers,
        json={"series_id": series_id, "season_number": 1, "episode_number": 1},
    )
    assert conflict.status_code == 400

    detail = client.get(f"/api/series/{series_id}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["series"]["episode_count"] == 2
    assert len(payload["seasons"]) == 1
    assert payload["seasons"][0]["season_number"] == 1
    assert [ep["title"] for ep in payload["seasons"][0]["episodes"]] == ["S1E1", "S1E2"]


def test_next_episode_and_detach(client, db_session, seeded):
    publisher = seeded["publisher"]
    headers = auth_header(publisher)
    now = datetime.now(timezone.utc)
    series = Series(
        id=generate(),
        publisher_id=publisher.id,
        title="River Road",
        description="",
        created_at=now,
        updated_at=now,
    )
    db_session.add(series)
    db_session.commit()

    e1 = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="E1",
        series_id=series.id,
        season_number=1,
        episode_number=1,
    )
    e2 = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="E2",
        series_id=series.id,
        season_number=2,
        episode_number=1,
    )

    book = client.get(f"/api/books/{e1.id}").json()["book"]
    assert book["series"]["id"] == series.id
    assert book["season_number"] == 1
    assert book["episode_number"] == 1
    assert book["next_episode"]["id"] == e2.id
    assert book["next_episode"]["season_number"] == 2

    recs = client.get(f"/api/books/{e1.id}/recommendations").json()
    assert recs["next_episode"]["id"] == e2.id

    end = client.get(f"/api/books/{e2.id}").json()["book"]
    assert end["next_episode"] is None

    detach = client.patch(
        f"/api/books/{e2.id}",
        headers=headers,
        json={"clear_series": True},
    )
    assert detach.status_code == 200
    refreshed = db_session.get(Book, e2.id)
    assert refreshed.series_id is None
    assert refreshed.season_number is None
    assert refreshed.episode_number is None

    after = client.get(f"/api/books/{e1.id}").json()["book"]
    assert after["next_episode"] is None


def test_series_continue_after_completed_episode(client, db_session, seeded):
    publisher = seeded["publisher"]
    reader = seeded["reader"]
    headers = auth_header(publisher)
    reader_headers = auth_header(reader)
    now = datetime.now(timezone.utc)
    series = Series(
        id=generate(),
        publisher_id=publisher.id,
        title="Continue Me",
        description="",
        created_at=now,
        updated_at=now,
    )
    db_session.add(series)
    db_session.commit()

    e1 = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="E1",
        series_id=series.id,
        season_number=1,
        episode_number=1,
    )
    e2 = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="E2",
        series_id=series.id,
        season_number=1,
        episode_number=2,
    )
    chapter = db_session.query(Chapter).filter(Chapter.book_id == e1.id).one()
    db_session.add(
        ReadingProgress(
            id=generate(),
            user_id=reader.id,
            book_id=e1.id,
            chapter_id=chapter.id,
            chapter_position=1,
            paragraph_index=0,
            scroll_fraction=1.0,
            completed_at=now,
            updated_at=now,
        )
    )
    db_session.commit()

    shelf = client.get("/api/reading", headers=reader_headers)
    assert shelf.status_code == 200
    payload = shelf.json()
    assert payload["items"] == []
    assert len(payload["series_continue"]) == 1
    assert payload["series_continue"][0]["book"]["id"] == e2.id
    assert payload["series_continue"][0]["episode_code"] == "S1E2"

    recs = client.get(f"/api/books/{e1.id}/recommendations", headers=reader_headers).json()
    assert recs["next_episode"]["id"] == e2.id
    assert recs["next_episode_owned"] is False


def test_admin_list_all_series_and_place_episode(client, db_session, seeded):
    publisher = seeded["publisher"]
    now = datetime.now(timezone.utc)
    admin = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="admin@example.com",
        name="Admin",
        role="admin",
        password_hash=hash_password("admin123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    db_session.add(admin)
    db_session.commit()

    created = client.post(
        "/api/series",
        headers=auth_header(publisher),
        json={"title": "Admin Visible", "description": ""},
    )
    assert created.status_code == 200
    series_id = created.json()["series"]["id"]

    denied = client.get("/api/series?all=1", headers=auth_header(publisher))
    assert denied.status_code == 403

    listed = client.get("/api/series?all=1", headers=auth_header(admin))
    assert listed.status_code == 200
    assert any(item["id"] == series_id for item in listed.json()["series"])

    book = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="Unplaced",
    )
    book.status = "pending_review"
    book.visibility = "listed"
    db_session.commit()

    place = client.patch(
        f"/api/admin/books/{book.id}",
        headers=auth_header(admin),
        json={"series_id": series_id, "season_number": 2, "episode_number": 3},
    )
    assert place.status_code == 200
    payload = place.json()["book"]
    assert payload["series"]["id"] == series_id
    assert payload["season_number"] == 2
    assert payload["episode_number"] == 3

    queue = client.get("/api/admin/queue", headers=auth_header(admin))
    assert queue.status_code == 200
    row = next(item for item in queue.json()["books"] if item["id"] == book.id)
    assert row["series"]["id"] == series_id
    assert row["season_number"] == 2
    assert row["episode_number"] == 3

    clear = client.patch(
        f"/api/admin/books/{book.id}",
        headers=auth_header(admin),
        json={"clear_series": True},
    )
    assert clear.status_code == 200
    assert clear.json()["book"]["series"] is None


def test_delete_series_unassigns_episodes(client, db_session, seeded):
    publisher = seeded["publisher"]
    headers = auth_header(publisher)
    created = client.post(
        "/api/series",
        headers=headers,
        json={"title": "To Delete", "description": ""},
    )
    series_id = created.json()["series"]["id"]
    e1 = _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="Keep me",
        series_id=series_id,
        season_number=1,
        episode_number=1,
    )

    deleted = client.delete(f"/api/series/{series_id}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["cleared_episodes"] == 1

    db_session.refresh(e1)
    assert e1.series_id is None
    assert e1.season_number is None
    assert e1.episode_number is None
    assert db_session.get(Series, series_id) is None


def test_admin_hide_series_from_public(client, db_session, seeded):
    publisher = seeded["publisher"]
    now = datetime.now(timezone.utc)
    admin = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="admin2@example.com",
        name="Admin2",
        role="admin",
        password_hash=hash_password("admin123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    db_session.add(admin)
    db_session.commit()

    created = client.post(
        "/api/series",
        headers=auth_header(publisher),
        json={"title": "Hide Me", "description": ""},
    )
    series_id = created.json()["series"]["id"]
    _create_published_episode(
        db_session,
        publisher=publisher,
        category_id=seeded["fiction"].id,
        title="Public ep",
        series_id=series_id,
        season_number=1,
        episode_number=1,
    )

    denied = client.patch(
        f"/api/series/{series_id}",
        headers=auth_header(publisher),
        json={"visibility": "hidden"},
    )
    assert denied.status_code == 403

    hidden = client.patch(
        f"/api/series/{series_id}",
        headers=auth_header(admin),
        json={"visibility": "hidden"},
    )
    assert hidden.status_code == 200
    assert hidden.json()["series"]["visibility"] == "hidden"

    public = client.get("/api/series")
    assert public.status_code == 200
    assert all(item["id"] != series_id for item in public.json()["series"])

    detail = client.get(f"/api/series/{series_id}")
    assert detail.status_code == 404

    manager = client.get(f"/api/series/{series_id}", headers=auth_header(publisher))
    assert manager.status_code == 200
    assert manager.json()["series"]["visibility"] == "hidden"
