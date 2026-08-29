from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from nanoid import generate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password
from app.categories import ensure_categories
from app.config import get_settings
from app.db import Base, get_db
from app.main import app
from app.models import User


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

    app.router.on_startup.clear()
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def hub_token(monkeypatch):
    monkeypatch.setenv("HUB_SYNC_TOKEN", "hub-test-token")
    get_settings.cache_clear()
    yield "hub-test-token"
    get_settings.cache_clear()


def test_hub_sync_creates_a_new_queue_book_each_publish(client, db_session, hub_token):
    from sqlalchemy import select

    from app.models import Book

    ensure_categories(db_session)
    now = datetime.now(timezone.utc)
    db_session.add(
        User(
            id=generate(),
            firebase_uid="dev-admin",
            email="admin@read.app",
            name="Admin",
            role="admin",
            password_hash=hash_password("x"),
            created_at=now,
        )
    )
    db_session.commit()

    body = {
        "hub_work_id": "locke--second_treatise",
        "hub_version": 1,
        "hub_content_hash": "abc",
        "title": "Second Treatise",
        "description": "PD",
        "category_slug": "essays",
        "raw_text": "Chapter I\n\nOf civil government.\n\n" * 40,
        "hub_license_snapshot": {"license": "public_domain_usa_gutenberg"},
    }
    headers = {"X-Hub-Sync-Token": hub_token}
    first = client.post("/api/internal/hub/works", json=body, headers=headers)
    assert first.status_code == 200, first.text
    created = first.json()
    assert created["created"] is True
    assert created["unchanged"] is False
    assert created["status"] == "pending_review"
    assert created["chapter_count"] >= 1

    body["title"] = "Second Treatise (revised title)"
    second = client.post("/api/internal/hub/works", json=body, headers=headers)
    assert second.status_code == 200, second.text
    replay = second.json()
    assert replay["created"] is True
    assert replay["unchanged"] is False
    assert replay["status"] == "pending_review"
    assert replay["id"] != created["id"]

    db_session.expire_all()
    rows = list(db_session.scalars(select(Book).where(Book.hub_work_id == "locke--second_treatise")))
    assert {row.id for row in rows} == {created["id"], replay["id"]}
    newest = next(row for row in rows if row.id == replay["id"])
    assert newest.title == "Second Treatise (revised title)"
    assert newest.status == "pending_review"


def test_hub_sync_stores_glossary_notes(client, db_session, hub_token):
    from sqlalchemy import select

    from app.glossary import aliases_from_storage
    from app.models import Book, GlossaryEntry

    ensure_categories(db_session)
    body = {
        "hub_work_id": "grotius--freedom_of_the_seas",
        "hub_version": 1,
        "hub_content_hash": "fn-1",
        "title": "The Freedom of the Seas",
        "category_slug": "essays",
        "raw_text": "Chapter I\n\nSeneca[4] thinks this is Nature's greatest service.\n\n" * 20,
        "glossary": [
            {
                "name": "Seneca",
                "aliases": ["[4]"],
                "summary": "Seneca, Natural Questions.",
                "group_label": "Chú thích",
            }
        ],
    }
    res = client.post(
        "/api/internal/hub/works",
        json=body,
        headers={"X-Hub-Sync-Token": hub_token},
    )
    assert res.status_code == 200, res.text
    assert res.json()["glossary_count"] == 1
    db_session.expire_all()
    book = db_session.scalar(select(Book).where(Book.hub_work_id == "grotius--freedom_of_the_seas"))
    assert book is not None
    rows = list(db_session.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id)))
    assert len(rows) == 1
    assert rows[0].name == "Seneca"
    assert rows[0].cast_locked is True
    assert "[4]" in aliases_from_storage(rows[0].aliases)


def test_hub_sync_prefers_notes_payload(client, db_session, hub_token):
    from sqlalchemy import select

    from app.glossary import aliases_from_storage
    from app.models import Book, GlossaryEntry

    ensure_categories(db_session)
    body = {
        "hub_work_id": "grotius--freedom_of_the_seas_vi",
        "hub_version": 1,
        "hub_content_hash": "notes-1",
        "title": "Tự do các đại dương",
        "category_slug": "essays",
        "status": "published",
        "raw_text": "Chương I\n\nSeneca[4] nghĩ đây là ơn lớn nhất.\n\n" * 20,
        "glossary": [
            {
                "name": "Seneca",
                "aliases": ["[4]"],
                "summary": "old",
                "group_label": "Chú thích",
            }
        ],
        "notes": [
            {
                "id": "fn-4",
                "kind": "footnote",
                "label": "Seneca [4]",
                "marker": "[4]",
                "anchor": "Seneca",
                "chapter": "I",
                "body": "Seneca trẻ.",
                "group_label": "Chú thích",
            },
            {
                "id": "fn-48",
                "kind": "footnote",
                "label": "Seneca [48]",
                "marker": "[48]",
                "anchor": "Seneca",
                "chapter": "V",
                "body": "Seneca, Thyestes.",
                "group_label": "Chú thích",
            },
        ],
    }
    res = client.post(
        "/api/internal/hub/works",
        json=body,
        headers={"X-Hub-Sync-Token": hub_token},
    )
    assert res.status_code == 200, res.text
    assert res.json()["glossary_count"] == 2
    db_session.expire_all()
    book = db_session.scalar(select(Book).where(Book.hub_work_id == "grotius--freedom_of_the_seas_vi"))
    rows = list(db_session.scalars(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id)))
    names = {row.name for row in rows}
    assert names == {"Seneca [4]", "Seneca [48]"}
    four = next(row for row in rows if row.name == "Seneca [4]")
    assert four.episode_title == "Seneca"
    assert four.episode_key == "I"
    assert aliases_from_storage(four.aliases) == ["[4]"]
    chapter_id = book.chapters[0].id
    chapter = client.get(f"/api/books/{book.id}/chapters/{chapter_id}")
    assert chapter.status_code == 200
    notes = chapter.json().get("notes") or []
    assert {item["name"] for item in notes} == {"Seneca [4]", "Seneca [48]"}


def test_hub_sync_stores_credits(client, db_session, hub_token):
    from sqlalchemy import select

    from app.models import Book

    ensure_categories(db_session)
    body = {
        "hub_work_id": "grotius--freedom_of_the_seas_vi",
        "hub_version": 1,
        "hub_content_hash": "credits-1",
        "title": "The Freedom of the Seas (Tiếng Việt)",
        "category_slug": "essays",
        "status": "published",
        "raw_text": "Chương I\n\nBiển cả là tự do.\n\n" * 20,
        "credits": {
            "author_name": "Hugo Grotius",
            "author_hub_id": "grotius",
            "translator_name": "Knowledge Hub",
            "translator_role": "hub_editorial",
            "source": {
                "hub_work_id": "grotius--freedom_of_the_seas",
                "title": "The Freedom of the Seas",
                "year": 1609,
                "language": "en",
            },
        },
    }
    res = client.post(
        "/api/internal/hub/works",
        json=body,
        headers={"X-Hub-Sync-Token": hub_token},
    )
    assert res.status_code == 200, res.text
    db_session.expire_all()
    book = db_session.scalar(select(Book).where(Book.hub_work_id == "grotius--freedom_of_the_seas_vi"))
    assert book.author_name == "Hugo Grotius"
    assert book.author_hub_id == "grotius"
    assert book.translator_name == "Knowledge Hub"
    assert book.source_title == "The Freedom of the Seas"
    assert book.source_year == 1609
    detail = client.get(f"/api/books/{book.id}")
    assert detail.status_code == 200
    payload = detail.json()["book"]
    assert payload["author_name"] == "Hugo Grotius"
    assert payload["publisher_name"] == "Knowledge Hub"
    assert payload["translator_name"] == "Knowledge Hub"
    assert payload["source"]["title"] == "The Freedom of the Seas"
    assert payload["source"]["year"] == 1609


def test_hub_sync_rejects_bad_token(client, hub_token):
    r = client.post(
        "/api/internal/hub/works",
        json={
            "hub_work_id": "x--y",
            "title": "T",
            "raw_text": "Hello world " * 50,
        },
        headers={"X-Hub-Sync-Token": "nope"},
    )
    assert r.status_code == 401
