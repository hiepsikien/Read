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
from app.glossary import aliases_to_storage
from app.main import app
from app.models import Book, Chapter, GlossaryEntry, User


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
        created_at=now,
    )
    db_session.add(publisher)
    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=categories[0].id,
        title="S1E1 — Đại Lộ Đại Dương",
        description="Sample",
        price_cents=0,
        status="published",
        raw_text="ok",
        created_at=now,
        updated_at=now,
    )
    db_session.add(book)
    chapter = Chapter(
        id=generate(),
        book_id=book.id,
        position=1,
        title="S1E1C1 — Opening",
        content=(
            "Bờ biển Calicut.\n\n"
            "VASCO DA GAMA đã đi vào lịch sử.\n\n"
            "AFONSO DE ALBUQUERQUE đứng trên boong."
        ),
        word_count=20,
        group_index=1,
    )
    db_session.add(chapter)
    for name, aliases, summary in [
        ("Vasco da Gama", [], "(k. 1469 – 1524) Nhà thám hiểm Bồ Đào Nha."),
        ("Afonso de Albuquerque", [], "(k. 1453 – 1515) Đô đốc Bồ Đào Nha."),
        ("Mạc Đăng Dung", [], "(1483 – 1541) Người làng Cổ Trai."),
    ]:
        db_session.add(
            GlossaryEntry(
                id=generate(),
                book_id=book.id,
                episode_key="S1E1",
                episode_title="GIÔNG BÃO KINH THÀNH",
                group_label="NHÂN VẬT LỊCH SỬ QUỐC TẾ",
                name=name,
                aliases=aliases_to_storage(aliases),
                summary=summary,
                sort_key=name.casefold(),
                created_at=now,
                updated_at=now,
            )
        )
    db_session.commit()
    return {"publisher": publisher, "book": book, "chapter": chapter, "db": db_session}


def test_explain_returns_book_note_without_ai(client, seeded):
    book = seeded["book"]
    chapter = seeded["chapter"]
    response = client.post(
        f"/api/books/{book.id}/chapters/{chapter.id}/explain",
        json={"query": "Vasco da Gama", "need_context": False},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["ai_used"] is False
    assert payload["card"]["title"] == "Vasco da Gama"
    assert "Bồ Đào Nha" in payload["card"]["book_note"]
    assert "book" in payload["card"]["sources"]
    assert payload["card"]["ai_context"] == ""


def test_explain_cache_hit(client, seeded):
    book = seeded["book"]
    chapter = seeded["chapter"]
    path = f"/api/books/{book.id}/chapters/{chapter.id}/explain"
    first = client.post(path, json={"query": "Vasco da Gama"}).json()
    second = client.post(path, json={"query": "Vasco da Gama"}).json()
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True


def test_explain_paragraph_candidates(client, seeded):
    book = seeded["book"]
    chapter = seeded["chapter"]
    # Paragraph 1 mentions Vasco only → direct card
    response = client.post(
        f"/api/books/{book.id}/chapters/{chapter.id}/explain",
        json={"paragraph_index": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["card"]["title"] == "Vasco da Gama"


def test_list_glossary_compact(client, seeded):
    book = seeded["book"]
    response = client.get(f"/api/books/{book.id}/glossary")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 3
    assert "summary" not in payload["entries"][0]


def test_upload_glossary_docx(client, seeded, tmp_path):
    from docx import Document

    book = seeded["book"]
    book.status = "draft"
    seeded["db"].commit()
    token = mint_dev_id_token(
        uid=seeded["publisher"].firebase_uid or seeded["publisher"].id,
        email=seeded["publisher"].email,
        name=seeded["publisher"].name,
    )

    doc = Document()
    doc.add_heading("NHÂN VẬT", level=1)
    doc.add_heading("S1E1: TEST", level=2)
    doc.add_paragraph("NHÂN VẬT LỊCH SỬ QUỐC TẾ")
    doc.add_paragraph("Christopher Columbus (1451 – 1506): Nhà hàng hải người Ý.")
    path = tmp_path / "glossary.docx"
    doc.save(path)

    with path.open("rb") as handle:
        response = client.post(
            f"/api/books/{book.id}/glossary",
            headers={"Authorization": f"Bearer {token}"},
            files={
                "file": (
                    "glossary.docx",
                    handle,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["count"] == 1

    listed = client.get(
        f"/api/books/{book.id}/glossary",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    assert listed["count"] == 1
    assert listed["entries"][0]["name"] == "Christopher Columbus"
