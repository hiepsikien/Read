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
from app.handles import validate_handle
from app.legal import CURRENT_LEGAL_VERSION
from app.main import app
from app.models import Book, User


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
        handle="coastwriter",
        role="publisher",
        password_hash=hash_password("password123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    legacy = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="legacy@example.com",
        name="Legacy User",
        handle=None,
        role="reader",
        password_hash=hash_password("legacy123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    reader = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="reader@example.com",
        name="Reader",
        handle="quietreader",
        role="reader",
        password_hash=hash_password("reader123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    db_session.add_all([publisher, legacy, reader])
    db_session.commit()

    fiction = next(c for c in categories if c.slug == "fiction")
    listed = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Listed Book",
        description="Public",
        price_cents=0,
        status="published",
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    draft = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Draft Book",
        description="Hidden draft",
        price_cents=0,
        status="draft",
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    hidden = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Hidden Book",
        description="Hidden published",
        price_cents=0,
        status="published",
        visibility="hidden",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([listed, draft, hidden])
    db_session.commit()
    return {
        "publisher": publisher,
        "legacy": legacy,
        "reader": reader,
        "listed": listed,
        "fiction": fiction,
    }


def auth_header(user: User) -> dict[str, str]:
    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"Authorization": f"Bearer {token}"}


def test_validate_handle_rejects_reserved_and_bad_format():
    with pytest.raises(Exception):
        validate_handle("ab")
    with pytest.raises(Exception):
        validate_handle("Bad-Handle")
    with pytest.raises(Exception):
        validate_handle("books")
    assert validate_handle("@CoastWriter") == "coastwriter"


def test_claim_handle_once(client, seeded):
    legacy = seeded["legacy"]
    response = client.post(
        "/api/auth/claim-handle",
        headers=auth_header(legacy),
        json={"handle": "LegacyUser"},
    )
    assert response.status_code == 200
    assert response.json()["user"]["handle"] == "legacyuser"

    again = client.post(
        "/api/auth/claim-handle",
        headers=auth_header(legacy),
        json={"handle": "someoneelse"},
    )
    assert again.status_code == 400
    assert "already set" in again.json()["error"].lower()


def test_claim_handle_unique_case_insensitive(client, seeded):
    legacy = seeded["legacy"]
    response = client.post(
        "/api/auth/claim-handle",
        headers=auth_header(legacy),
        json={"handle": "CoastWriter"},
    )
    assert response.status_code == 409
    assert "taken" in response.json()["error"].lower()


def test_me_includes_handle(client, seeded):
    publisher = seeded["publisher"]
    me = client.get("/api/auth/me", headers=auth_header(publisher))
    assert me.status_code == 200
    assert me.json()["user"]["handle"] == "coastwriter"


def test_public_profile_lists_only_published_listed(client, seeded):
    response = client.get("/api/profiles/coastwriter")
    assert response.status_code == 200
    payload = response.json()
    assert payload["profile"]["handle"] == "coastwriter"
    assert payload["profile"]["name"] == "Author"
    titles = [book["title"] for book in payload["books"]]
    assert titles == ["Listed Book"]
    assert payload["books"][0]["publisher_handle"] == "coastwriter"


def test_public_profile_404(client, seeded):
    missing = client.get("/api/profiles/missinguser")
    assert missing.status_code == 404
    reserved = client.get("/api/profiles/books")
    assert reserved.status_code == 404


def test_empty_reader_profile(client, seeded):
    response = client.get("/api/profiles/quietreader")
    assert response.status_code == 200
    assert response.json()["books"] == []


def test_list_books_includes_publisher_handle(client, seeded):
    response = client.get("/api/books")
    assert response.status_code == 200
    books = response.json()["books"]
    assert any(book.get("publisher_handle") == "coastwriter" for book in books)


def test_indie_books_keep_empty_credits(client, seeded):
    response = client.get("/api/books")
    book = next(item for item in response.json()["books"] if item["title"] == "Listed Book")
    assert book["publisher_name"] == "Author"
    assert book["author_name"] == "Author"
    assert book["author_hub_id"] == ""
    assert book["translator_name"] == ""
    assert book["translator_role"] == ""
    assert book["source"] is None
    detail = client.get(f"/api/books/{book['id']}")
    assert detail.status_code == 200
    payload = detail.json()["book"]
    assert payload["author_name"] == "Author"
    assert payload["source"] is None
