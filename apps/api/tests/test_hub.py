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


def test_hub_sync_upserts_by_work_id(client, db_session, hub_token):
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
    assert created["chapter_count"] >= 1

    second = client.post("/api/internal/hub/works", json=body, headers=headers)
    assert second.status_code == 200
    assert second.json()["unchanged"] is True
    assert second.json()["id"] == created["id"]


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
