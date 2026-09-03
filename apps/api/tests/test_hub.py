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


def test_hub_sync_uses_hub_chapters_and_ref_meta(client, db_session, hub_token):
    from sqlalchemy import select

    from app.models import Book, Chapter

    ensure_categories(db_session)
    body = {
        "hub_work_id": "arnold--essays_in_criticism",
        "hub_version": 1,
        "hub_content_hash": "ref-pilot-1",
        "title": "Essays in Criticism",
        "category_slug": "essays",
        "raw_text": "fallback should not drive split",
        "edition_format": "ref/1",
        "edition_hash": "b" * 64,
        "content_kind": "prose",
        "chapters": [
            {
                "id": "ch-001",
                "title": "The Function of Criticism",
                "content": "Poetry is the criticism of life.[1]",
                "blocks": [
                    {
                        "type": "paragraph",
                        "text": "Poetry is the criticism of life.[1]",
                        "spans": [
                            {
                                "style": "footnote",
                                "start": 32,
                                "end": 35,
                                "text": "[1]",
                                "note": "Arnold's phrase.",
                            }
                        ],
                    }
                ],
            },
            {
                "id": "ch-002",
                "title": "The Literary Influence of Academies",
                "content": "Second chapter body.",
            },
        ],
        "notes": [
            {
                "kind": "footnote",
                "label": "[1]",
                "marker": "[1]",
                "body": "Arnold's phrase.",
                "chapter": "ch-001",
            }
        ],
    }
    res = client.post(
        "/api/internal/hub/works",
        json=body,
        headers={"X-Hub-Sync-Token": hub_token},
    )
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["chapter_count"] == 2
    assert payload["used_hub_chapters"] is True
    assert payload["edition_format"] == "ref/1"
    db_session.expire_all()
    book = db_session.scalar(select(Book).where(Book.hub_work_id == "arnold--essays_in_criticism"))
    assert book is not None
    assert book.edition_hash == "b" * 64
    chapters = list(db_session.scalars(select(Chapter).where(Chapter.book_id == book.id).order_by(Chapter.position)))
    assert [c.title for c in chapters] == [
        "The Function of Criticism",
        "The Literary Influence of Academies",
    ]
    assert chapters[0].hub_chapter_id == "ch-001"
    assert chapters[0].blocks_json and '"footnote"' in chapters[0].blocks_json
    assert book.language == "en"
    chapter = client.get(f"/api/books/{book.id}/chapters/{chapters[0].id}")
    assert chapter.status_code == 200
    assert chapter.json()["book"]["language"] == "en"


def test_hub_sync_stores_note_host_and_language(client, db_session, hub_token):
    from sqlalchemy import select

    from app.models import Book, GlossaryEntry

    ensure_categories(db_session)
    body = {
        "hub_work_id": "bach--abdy_williams",
        "hub_version": 1,
        "hub_content_hash": "host-1",
        "title": "Bach",
        "language": "en",
        "category_slug": "essays",
        "raw_text": "CHAPTER I\n\nHe studied with Adlung.[12]\n\n" * 10,
        "chapters": [
            {
                "id": "ch-001",
                "title": "CHAPTER I",
                "content": "He studied with Adlung.[12]",
                "blocks": [
                    {
                        "type": "paragraph",
                        "block_id": "ch-001:paragraph:he-studied",
                        "text": "He studied with Adlung.[12]",
                    }
                ],
            }
        ],
        "notes": [
            {
                "kind": "footnote",
                "label": "Adlung [12]",
                "marker": "[12]",
                "body": "Adlung of Erfurt.",
                "chapter": "ch-001",
                "host_block_id": "ch-001:paragraph:he-studied",
                "host_text": "He studied with Adlung.[12]",
            }
        ],
    }
    res = client.post(
        "/api/internal/hub/works",
        json=body,
        headers={"X-Hub-Sync-Token": hub_token},
    )
    assert res.status_code == 200, res.text
    db_session.expire_all()
    book = db_session.scalar(select(Book).where(Book.hub_work_id == "bach--abdy_williams"))
    assert book.language == "en"
    note = db_session.scalar(select(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    assert note.host_block_id == "ch-001:paragraph:he-studied"
    assert note.host_text == "He studied with Adlung.[12]"
    chapter_id = book.chapters[0].id
    payload = client.get(f"/api/books/{book.id}/chapters/{chapter_id}").json()
    assert payload["book"]["language"] == "en"
    assert payload["notes"][0]["host_text"] == "He studied with Adlung.[12]"
