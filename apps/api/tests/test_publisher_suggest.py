from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

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
from app.models import Book, User
from app.publisher_suggest import manuscript_sample, parse_suggestion_payload


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
    other = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="other@example.com",
        name="Other",
        role="publisher",
        password_hash=hash_password("password123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    db_session.add_all([publisher, other])
    db_session.commit()

    fiction = next(c for c in categories if c.slug == "fiction")
    draft = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Sea Route",
        description="",
        price_cents=0,
        status="draft",
        visibility="listed",
        raw_text="Chapter 1\n\nA captain sails east toward a new empire.\n\nStorms gather.",
        created_at=now,
        updated_at=now,
    )
    empty = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Empty",
        description="",
        price_cents=0,
        status="draft",
        visibility="listed",
        raw_text="",
        created_at=now,
        updated_at=now,
    )
    published = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Live Book",
        description="Out already",
        price_cents=0,
        status="published",
        visibility="listed",
        raw_text="Already published text.",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([draft, empty, published])
    db_session.commit()
    return {
        "publisher": publisher,
        "other": other,
        "draft": draft,
        "empty": empty,
        "published": published,
        "fiction": fiction,
    }


def auth_header(user: User) -> dict[str, str]:
    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"Authorization": f"Bearer {token}"}


def test_parse_suggestion_validates_slug_and_clamps_description():
    parsed = parse_suggestion_payload(
        '{"category_slug":"fantasy","description":"' + ("x" * 500) + '"}'
    )
    assert parsed["category_slug"] == "fantasy"
    assert len(parsed["description"]) <= 400

    invalid = parse_suggestion_payload('{"category_slug":"not-a-real-slug","description":"Hi"}')
    assert invalid["category_slug"] == "other"
    assert invalid["description"] == "Hi"


def test_manuscript_sample_truncates_near_paragraph():
    body = ("Para one.\n\n" * 2000) + "Tail"
    sample = manuscript_sample("Title", body, max_chars=200)
    assert sample.startswith("Title: Title")
    assert len(sample) < 250
    assert "…" in sample


def test_suggest_unavailable_when_ai_off(client, seeded, monkeypatch):
    monkeypatch.setenv("AI_EXPLAIN_ENABLED", "false")
    from app.config import get_settings

    get_settings.cache_clear()
    response = client.post(
        f"/api/books/{seeded['draft'].id}/suggest-metadata",
        headers=auth_header(seeded["publisher"]),
    )
    assert response.status_code == 503
    assert response.json()["error"] == "ai_unavailable"
    get_settings.cache_clear()


def test_suggest_rejects_non_owner(client, seeded, monkeypatch):
    monkeypatch.setenv("AI_EXPLAIN_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    response = client.post(
        f"/api/books/{seeded['draft'].id}/suggest-metadata",
        headers=auth_header(seeded["other"]),
    )
    assert response.status_code == 404
    get_settings.cache_clear()


def test_suggest_requires_raw_text(client, seeded, monkeypatch):
    monkeypatch.setenv("AI_EXPLAIN_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    response = client.post(
        f"/api/books/{seeded['empty'].id}/suggest-metadata",
        headers=auth_header(seeded["publisher"]),
    )
    assert response.status_code == 400
    get_settings.cache_clear()


def test_suggest_rejects_published(client, seeded, monkeypatch):
    monkeypatch.setenv("AI_EXPLAIN_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    response = client.post(
        f"/api/books/{seeded['published'].id}/suggest-metadata",
        headers=auth_header(seeded["publisher"]),
    )
    assert response.status_code == 400
    get_settings.cache_clear()


def test_suggest_maps_valid_and_invalid_slugs(client, seeded, monkeypatch):
    monkeypatch.setenv("AI_EXPLAIN_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    with patch(
        "app.publisher_suggest.generate_gemini_text",
        new=AsyncMock(
            return_value='{"category_slug":"historical-fiction","description":"A captain sails east."}'
        ),
    ) as mocked:
        ok = client.post(
            f"/api/books/{seeded['draft'].id}/suggest-metadata",
            headers=auth_header(seeded["publisher"]),
            json={"language": "vi"},
        )
    assert ok.status_code == 200
    body = ok.json()
    assert body["ai_used"] is True
    assert body["category"]["slug"] == "historical-fiction"
    assert body["description"] == "A captain sails east."
    system = mocked.await_args.kwargs["system"]
    assert "Vietnamese" in system

    with patch(
        "app.publisher_suggest.generate_gemini_text",
        new=AsyncMock(
            return_value='{"category_slug":"banana-genre","description":"Still a story."}'
        ),
    ):
        fallback = client.post(
            f"/api/books/{seeded['draft'].id}/suggest-metadata",
            headers=auth_header(seeded["publisher"]),
        )
    assert fallback.status_code == 200
    assert fallback.json()["category"]["slug"] == "other"
    get_settings.cache_clear()
