from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from nanoid import generate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password, mint_dev_id_token, resolve_role_for_email, verify_id_token
from app.categories import CATEGORY_SEED, ensure_categories
from app.db import Base, get_db
from app.legal import CURRENT_LEGAL_VERSION
from app.main import app
from app.models import Book, Chapter, ModerationEvent, User
from app.routers import admin as admin_router


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
    admin = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="admin@read.app",
        name="Admin",
        role="admin",
        password_hash=hash_password("admin123"),
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
    db_session.add_all([publisher, admin, reader])
    db_session.commit()
    return {
        "categories": categories,
        "publisher": publisher,
        "admin": admin,
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


def test_dev_token_round_trip():
    token = mint_dev_id_token(uid="uid-1", email="a@read.app", name="Ada")
    claims = verify_id_token(token)
    assert claims.uid == "uid-1"
    assert claims.email == "a@read.app"
    assert claims.name == "Ada"


def test_admin_email_resolves_to_admin_role():
    assert resolve_role_for_email("admin@read.app") == "admin"
    assert resolve_role_for_email("reader@example.com") == "reader"
    assert resolve_role_for_email("reader@example.com", "publisher") == "publisher"


def test_category_seed_is_stable(db_session):
    first = ensure_categories(db_session)
    second = ensure_categories(db_session)
    assert len(first) == len(CATEGORY_SEED)
    assert [c.slug for c in first] == [c.slug for c in second]


def test_dev_login_and_me(client, seeded):
    response = client.post(
        "/api/auth/dev-login",
        json={"email": "author@example.com", "password": "password123"},
    )
    assert response.status_code == 200
    token = response.json()["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "author@example.com"
    assert me.json()["user"]["role"] == "publisher"


def test_enable_author(client, seeded):
    reader = seeded["reader"]
    response = client.post(
        "/api/auth/enable-author",
        headers=auth_header(reader),
        json={"enabled": True},
    )
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "publisher"


def test_rejects_pdf_upload(client, seeded, tmp_path):
    publisher = seeded["publisher"]
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    with pdf.open("rb") as handle:
        response = client.post(
            "/api/books",
            headers=auth_header(publisher),
            data={
                "title": "PDF Attempt",
                "description": "Nope",
                "pricing": "free",
                "category_id": seeded["fiction"].id,
            },
            files={
                "file": (
                    "book.pdf",
                    handle,
                    "application/pdf",
                )
            },
        )
    assert response.status_code == 400
    assert "DOCX" in response.json()["error"]


def test_submit_review_requires_category(client, db_session, seeded):
    publisher = seeded["publisher"]
    now = datetime.now(timezone.utc)
    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=None,
        title="Incomplete",
        description="",
        price_cents=0,
        status="draft",
        raw_text="Hello world",
        created_at=now,
        updated_at=now,
    )
    db_session.add(book)
    db_session.commit()

    response = client.post(
        f"/api/books/{book.id}/submit-review",
        headers=auth_header(publisher),
    )
    assert response.status_code == 400


def test_moderation_approve_flow(client, db_session, seeded):
    publisher = seeded["publisher"]
    admin = seeded["admin"]
    fiction = seeded["fiction"]
    now = datetime.now(timezone.utc)

    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Ready Book",
        description="A story",
        price_cents=0,
        status="draft",
        raw_text="Chapter body",
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
            title="Chapter 1",
            content="Once upon a time.",
            word_count=4,
            group_index=1,
        )
    )
    db_session.commit()

    submit = client.post(
        f"/api/books/{book.id}/submit-review",
        headers=auth_header(publisher),
    )
    assert submit.status_code == 200
    assert submit.json()["status"] == "pending_review"

    queue = client.get("/api/admin/queue", headers=auth_header(admin))
    assert queue.status_code == 200
    assert any(item["id"] == book.id for item in queue.json()["books"])

    approve = client.post(
        f"/api/admin/books/{book.id}/approve",
        headers=auth_header(admin),
    )
    assert approve.status_code == 200
    assert approve.json()["status"] == "published"

    library = client.get("/api/books")
    assert any(item["id"] == book.id for item in library.json()["books"])


def test_reject_requires_note(client, db_session, seeded):
    publisher = seeded["publisher"]
    admin = seeded["admin"]
    fiction = seeded["fiction"]
    now = datetime.now(timezone.utc)

    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Needs Work",
        description="",
        price_cents=0,
        status="pending_review",
        raw_text="body",
        created_at=now,
        updated_at=now,
        submitted_at=now,
    )
    db_session.add(book)
    db_session.flush()
    db_session.add(
        Chapter(
            id=generate(),
            book_id=book.id,
            position=1,
            title="Chapter 1",
            content="Text",
            word_count=1,
            group_index=1,
        )
    )
    db_session.commit()

    bad = client.post(
        f"/api/admin/books/{book.id}/reject",
        headers=auth_header(admin),
        json={"note": "no"},
    )
    assert bad.status_code == 400

    ok = client.post(
        f"/api/admin/books/{book.id}/reject",
        headers=auth_header(admin),
        json={"note": "Please fix formatting and resubmit."},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "rejected"


def test_legal_acceptance_gate_and_version(client, db_session, seeded):
    reader = seeded["reader"]
    reader.accepted_legal_version = None
    reader.accepted_legal_at = None
    db_session.commit()

    blocked = client.post(
        "/api/auth/enable-author",
        headers=auth_header(reader),
        json={"enabled": True},
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"] == "terms_required"

    stale = client.post(
        "/api/auth/accept-legal",
        headers=auth_header(reader),
        json={"version": "2025-01-01"},
    )
    assert stale.status_code == 409
    assert stale.json()["current_legal_version"] == CURRENT_LEGAL_VERSION

    accepted = client.post(
        "/api/auth/accept-legal",
        headers=auth_header(reader),
        json={"version": CURRENT_LEGAL_VERSION},
    )
    assert accepted.status_code == 200
    assert accepted.json()["user"]["needs_legal_acceptance"] is False

    enabled = client.post(
        "/api/auth/enable-author",
        headers=auth_header(reader),
        json={"enabled": True},
    )
    assert enabled.status_code == 200
    assert enabled.json()["user"]["role"] == "publisher"


def test_submit_review_requires_current_legal_acceptance(client, db_session, seeded):
    publisher = seeded["publisher"]
    publisher.accepted_legal_version = None
    publisher.accepted_legal_at = None
    now = datetime.now(timezone.utc)
    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=seeded["fiction"].id,
        title="Agreement Gate",
        description="",
        price_cents=0,
        status="draft",
        raw_text="Body",
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
            title="Chapter 1",
            content="Body",
            word_count=1,
            group_index=1,
        )
    )
    db_session.commit()

    blocked = client.post(
        f"/api/books/{book.id}/submit-review",
        headers=auth_header(publisher),
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"] == "terms_required"

    publisher.accepted_legal_version = CURRENT_LEGAL_VERSION
    publisher.accepted_legal_at = now
    db_session.commit()
    submitted = client.post(
        f"/api/books/{book.id}/submit-review",
        headers=auth_header(publisher),
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "pending_review"


def test_feature_hide_relist_remove_and_library_order(client, db_session, seeded):
    publisher = seeded["publisher"]
    admin = seeded["admin"]
    fiction = seeded["fiction"]
    now = datetime.now(timezone.utc)
    normal = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Normal Book",
        description="",
        price_cents=0,
        status="published",
        featured=False,
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    featured = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Featured Book",
        description="",
        price_cents=0,
        status="published",
        featured=True,
        featured_at=now,
        featured_by=admin.id,
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([normal, featured])
    db_session.commit()

    library = client.get("/api/books").json()["books"]
    ids = [item["id"] for item in library]
    assert ids.index(featured.id) < ids.index(normal.id)

    hidden = client.post(
        f"/api/admin/books/{featured.id}/visibility",
        headers=auth_header(admin),
        json={"visibility": "hidden", "note": "Reviewing a report"},
    )
    assert hidden.status_code == 200
    assert hidden.json()["featured"] is False
    assert all(item["id"] != featured.id for item in client.get("/api/books").json()["books"])

    relisted = client.post(
        f"/api/admin/books/{featured.id}/visibility",
        headers=auth_header(admin),
        json={"visibility": "listed"},
    )
    assert relisted.status_code == 200
    assert any(item["id"] == featured.id for item in client.get("/api/books").json()["books"])

    removed = client.post(
        f"/api/admin/books/{featured.id}/visibility",
        headers=auth_header(admin),
        json={"visibility": "removed", "note": "Confirmed policy violation"},
    )
    assert removed.status_code == 200
    restore = client.post(
        f"/api/admin/books/{featured.id}/visibility",
        headers=auth_header(admin),
        json={"visibility": "listed"},
    )
    assert restore.status_code == 400


def test_report_flow_duplicate_and_hide_resolution(client, db_session, seeded):
    publisher = seeded["publisher"]
    reader = seeded["reader"]
    admin = seeded["admin"]
    fiction = seeded["fiction"]
    now = datetime.now(timezone.utc)
    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Reported Book",
        description="",
        price_cents=0,
        status="published",
        featured=True,
        featured_at=now,
        visibility="listed",
        created_at=now,
        updated_at=now,
    )
    db_session.add(book)
    db_session.commit()

    report = client.post(
        f"/api/books/{book.id}/report",
        headers=auth_header(reader),
        json={"reason": "misleading", "details": "Metadata does not match the content."},
    )
    assert report.status_code == 200
    duplicate = client.post(
        f"/api/books/{book.id}/report",
        headers=auth_header(reader),
        json={"reason": "other", "details": "Another reason"},
    )
    assert duplicate.status_code == 409
    owner = client.post(
        f"/api/books/{book.id}/report",
        headers=auth_header(publisher),
        json={"reason": "spam", "details": ""},
    )
    assert owner.status_code == 400

    reports = client.get("/api/admin/reports", headers=auth_header(admin))
    assert reports.status_code == 200
    report_id = reports.json()["reports"][0]["id"]
    resolved = client.post(
        f"/api/admin/reports/{report_id}/resolve",
        headers=auth_header(admin),
        json={"action": "hide", "note": "Hidden while publisher responds."},
    )
    assert resolved.status_code == 200
    assert resolved.json()["book_visibility"] == "hidden"
    db_session.refresh(book)
    assert book.featured is False


def test_admin_summary_pending_count(client, db_session, seeded):
    publisher = seeded["publisher"]
    admin = seeded["admin"]
    fiction = seeded["fiction"]
    now = datetime.now(timezone.utc)

    denied = client.get("/api/admin/summary")
    assert denied.status_code in {401, 403}

    reader_denied = client.get("/api/admin/summary", headers=auth_header(seeded["reader"]))
    assert reader_denied.status_code == 403

    empty = client.get("/api/admin/summary", headers=auth_header(admin))
    assert empty.status_code == 200
    assert empty.json()["pending_count"] == 0
    assert empty.json()["library_count"] == 0
    assert empty.json()["report_count"] == 0
    assert empty.json()["library_counts"] == {
        "listed": 0,
        "featured": 0,
        "rejected": 0,
        "hidden": 0,
        "removed": 0,
    }
    assert empty.json()["report_counts"] == {
        "open": 0,
        "resolved": 0,
        "dismissed": 0,
    }

    db_session.add(
        Book(
            id=generate(),
            publisher_id=publisher.id,
            category_id=fiction.id,
            title="Waiting",
            description="",
            price_cents=0,
            status="pending_review",
            created_at=now,
            updated_at=now,
            submitted_at=now,
        )
    )
    db_session.add(
        Book(
            id=generate(),
            publisher_id=publisher.id,
            category_id=fiction.id,
            title="Also waiting",
            description="",
            price_cents=0,
            status="pending_review",
            created_at=now,
            updated_at=now,
            submitted_at=now,
        )
    )
    db_session.add(
        Book(
            id=generate(),
            publisher_id=publisher.id,
            category_id=fiction.id,
            title="Live",
            description="",
            price_cents=0,
            status="published",
            visibility="listed",
            created_at=now,
            updated_at=now,
        )
    )
    db_session.commit()

    summary = client.get("/api/admin/summary", headers=auth_header(admin))
    assert summary.status_code == 200
    body = summary.json()
    assert body["pending_count"] == 2
    assert body["library_count"] == 1
    assert body["library_counts"]["listed"] == 1
    assert body["library_counts"]["featured"] == 0
    assert body["report_count"] == 0


def test_admin_listed_filter_and_catalog_edit(client, db_session, seeded, tmp_path, monkeypatch):
    import io

    from PIL import Image

    from app.config import Settings

    publisher = seeded["publisher"]
    admin = seeded["admin"]
    fiction = seeded["fiction"]
    nonfiction = next(c for c in seeded["categories"] if c.slug == "essays")
    now = datetime.now(timezone.utc)

    listed = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Listed Title",
        description="Old description",
        price_cents=0,
        status="published",
        visibility="listed",
        featured=True,
        featured_at=now,
        featured_by=admin.id,
        created_at=now,
        updated_at=now,
    )
    hidden = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Hidden Title",
        description="",
        price_cents=0,
        status="published",
        visibility="hidden",
        created_at=now,
        updated_at=now,
    )
    pending = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=fiction.id,
        title="Pending Title",
        description="",
        price_cents=0,
        status="pending_review",
        created_at=now,
        updated_at=now,
        submitted_at=now,
    )
    db_session.add_all([listed, hidden, pending])
    db_session.commit()

    listed_only = client.get(
        "/api/admin/books?status=published&visibility=listed",
        headers=auth_header(admin),
    )
    assert listed_only.status_code == 200
    listed_ids = {item["id"] for item in listed_only.json()["books"]}
    assert listed.id in listed_ids
    assert hidden.id not in listed_ids
    assert pending.id not in listed_ids

    publisher_blocked = client.patch(
        f"/api/books/{listed.id}",
        headers=auth_header(publisher),
        json={"title": "Publisher rewrite"},
    )
    assert publisher_blocked.status_code == 400

    reader_blocked = client.patch(
        f"/api/admin/books/{listed.id}",
        headers=auth_header(seeded["reader"]),
        json={"title": "Reader rewrite"},
    )
    assert reader_blocked.status_code == 403

    pending_blocked = client.patch(
        f"/api/admin/books/{pending.id}",
        headers=auth_header(admin),
        json={"title": "Should fail"},
    )
    assert pending_blocked.status_code == 400

    hidden_blocked = client.patch(
        f"/api/admin/books/{hidden.id}",
        headers=auth_header(admin),
        json={"title": "Should fail"},
    )
    assert hidden_blocked.status_code == 400

    updated = client.patch(
        f"/api/admin/books/{listed.id}",
        headers=auth_header(admin),
        json={
            "title": "Updated Title",
            "description": "Fresh blurb",
            "pricing": "paid",
            "price": 6.5,
            "category_id": nonfiction.id,
        },
    )
    assert updated.status_code == 200, updated.text
    payload = updated.json()["book"]
    assert payload["title"] == "Updated Title"
    assert payload["description"] == "Fresh blurb"
    assert payload["price_cents"] == 650
    assert payload["status"] == "published"
    assert payload["visibility"] == "listed"
    assert payload["featured"] is True
    assert payload["category"]["id"] == nonfiction.id

    db_session.refresh(listed)
    assert listed.title == "Updated Title"
    assert listed.price_cents == 650
    assert listed.status == "published"
    assert listed.visibility == "listed"
    assert listed.featured is True
    assert listed.category_id == nonfiction.id

    events = (
        db_session.query(ModerationEvent)
        .filter(ModerationEvent.book_id == listed.id, ModerationEvent.action == "edit_catalog")
        .all()
    )
    assert len(events) == 1

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    settings = Settings(upload_dir=str(upload_dir), auth_dev_mode=True)
    monkeypatch.setattr(admin_router, "get_settings", lambda: settings)

    image = Image.new("RGB", (700, 1000), (40, 90, 70))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    cover = client.post(
        f"/api/admin/books/{listed.id}/cover",
        files={"file": ("cover.jpg", buffer.getvalue(), "image/jpeg")},
        headers=auth_header(admin),
    )
    assert cover.status_code == 200, cover.text
    assert cover.json()["cover_url"] == f"/api/books/{listed.id}/cover"

    cover_events = (
        db_session.query(ModerationEvent)
        .filter(ModerationEvent.book_id == listed.id, ModerationEvent.action == "replace_cover")
        .all()
    )
    assert len(cover_events) == 1

    publisher_cover = client.post(
        f"/api/books/{listed.id}/cover",
        files={"file": ("cover.jpg", buffer.getvalue(), "image/jpeg")},
        headers=auth_header(publisher),
    )
    assert publisher_cover.status_code == 400

    hidden_cover = client.post(
        f"/api/admin/books/{hidden.id}/cover",
        files={"file": ("cover.jpg", buffer.getvalue(), "image/jpeg")},
        headers=auth_header(admin),
    )
    assert hidden_cover.status_code == 400
