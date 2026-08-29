from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from nanoid import generate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password, mint_dev_id_token
from app.categories import ensure_categories
from app.db import Base, get_db
from app.main import app
from app.models import Book, User
from app.recommendations import rank_related, sort_same_author, text_overlap_score, tokenize


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
    other = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="other@example.com",
        name="Other Pub",
        role="publisher",
        password_hash=hash_password("password123"),
        created_at=now,
    )
    db_session.add_all([publisher, other])
    db_session.commit()
    return {
        "categories": categories,
        "publisher": publisher,
        "other": other,
        "fiction": next(c for c in categories if c.slug == "fiction"),
        "romance": next(c for c in categories if c.slug == "romance"),
        "now": now,
    }


def auth_header(user: User) -> dict[str, str]:
    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"Authorization": f"Bearer {token}"}


def _book(
    *,
    publisher_id: str,
    title: str,
    description: str = "",
    category_id: str | None = None,
    status: str = "published",
    visibility: str = "listed",
    featured: bool = False,
    created_at: datetime | None = None,
) -> Book:
    now = created_at or datetime.now(timezone.utc)
    return Book(
        id=generate(),
        publisher_id=publisher_id,
        category_id=category_id,
        title=title,
        description=description,
        price_cents=0,
        status=status,
        visibility=visibility,
        featured=featured,
        featured_at=now if featured else None,
        created_at=now,
        updated_at=now,
    )


def test_tokenize_filters_stopwords():
    tokens = tokenize("The Harbor and the Sea of Dreams")
    assert "the" not in tokens
    assert "and" not in tokens
    assert "harbor" in tokens
    assert "dreams" in tokens


def test_text_overlap_scales():
    a = {"harbor", "dawn"}
    b = {"harbor", "night"}
    assert 0 < text_overlap_score(a, b) < 20
    assert text_overlap_score(a, set()) == 0


def test_sort_same_author_featured_then_recency(seeded):
    now = seeded["now"]
    older = _book(
        publisher_id=seeded["publisher"].id,
        title="Older",
        created_at=now - timedelta(days=10),
    )
    featured = _book(
        publisher_id=seeded["publisher"].id,
        title="Featured",
        featured=True,
        created_at=now - timedelta(days=30),
    )
    newer = _book(
        publisher_id=seeded["publisher"].id,
        title="Newer",
        created_at=now - timedelta(days=1),
    )
    ordered = sort_same_author([older, featured, newer])
    assert [b.title for b in ordered] == ["Featured", "Newer", "Older"]


def test_rank_related_prefers_same_category(seeded):
    source = _book(
        publisher_id=seeded["publisher"].id,
        title="Harbor Tales",
        description="A story about the harbor at dawn",
        category_id=seeded["fiction"].id,
    )
    same_cat = _book(
        publisher_id=seeded["other"].id,
        title="Quiet Town",
        description="Village life",
        category_id=seeded["fiction"].id,
    )
    other_cat = _book(
        publisher_id=seeded["other"].id,
        title="Harbor at Dawn Romance",
        description="A story about the harbor at dawn lovers",
        category_id=seeded["romance"].id,
    )
    ranked = rank_related(
        source=source,
        candidates=[other_cat, same_cat],
        exclude_ids=set(),
        limit=8,
    )
    assert ranked[0].id == same_cat.id


def test_recommendations_endpoint(client, db_session, seeded):
    now = seeded["now"]
    source = _book(
        publisher_id=seeded["publisher"].id,
        title="Source Book",
        description="Harbor dawn fiction",
        category_id=seeded["fiction"].id,
        created_at=now,
    )
    sibling_featured = _book(
        publisher_id=seeded["publisher"].id,
        title="Sibling Featured",
        category_id=seeded["fiction"].id,
        featured=True,
        created_at=now - timedelta(days=5),
    )
    sibling_new = _book(
        publisher_id=seeded["publisher"].id,
        title="Sibling New",
        category_id=seeded["fiction"].id,
        created_at=now - timedelta(days=1),
    )
    draft_sibling = _book(
        publisher_id=seeded["publisher"].id,
        title="Draft Sibling",
        status="draft",
        category_id=seeded["fiction"].id,
    )
    hidden_sibling = _book(
        publisher_id=seeded["publisher"].id,
        title="Hidden Sibling",
        visibility="hidden",
        category_id=seeded["fiction"].id,
    )
    related_same = _book(
        publisher_id=seeded["other"].id,
        title="Related Fiction",
        description="Another quiet tale",
        category_id=seeded["fiction"].id,
    )
    related_other = _book(
        publisher_id=seeded["other"].id,
        title="Romance Harbor Dawn",
        description="Harbor dawn romance",
        category_id=seeded["romance"].id,
    )
    db_session.add_all(
        [
            source,
            sibling_featured,
            sibling_new,
            draft_sibling,
            hidden_sibling,
            related_same,
            related_other,
        ]
    )
    db_session.commit()

    response = client.get(f"/api/books/{source.id}/recommendations")
    assert response.status_code == 200
    payload = response.json()

    same_ids = [b["id"] for b in payload["same_author"]]
    assert source.id not in same_ids
    assert draft_sibling.id not in same_ids
    assert hidden_sibling.id not in same_ids
    assert same_ids == [sibling_featured.id, sibling_new.id]

    related_ids = [b["id"] for b in payload["related"]]
    assert source.id not in related_ids
    assert sibling_featured.id not in related_ids
    assert sibling_new.id not in related_ids
    assert related_ids[0] == related_same.id
    assert related_other.id in related_ids


def test_recommendations_same_author_by_hub_id(client, db_session, seeded):
    now = seeded["now"]
    grotius_vi = _book(
        publisher_id=seeded["publisher"].id,
        title="Freedom of the Seas VI",
        description="mare liberum translation",
        category_id=seeded["fiction"].id,
        created_at=now,
    )
    grotius_vi.author_name = "Hugo Grotius"
    grotius_vi.author_hub_id = "grotius"
    grotius_en = _book(
        publisher_id=seeded["publisher"].id,
        title="Freedom of the Seas",
        description="mare liberum original",
        category_id=seeded["fiction"].id,
        created_at=now - timedelta(days=1),
    )
    grotius_en.author_name = "Hugo Grotius"
    grotius_en.author_hub_id = "grotius"
    locke = _book(
        publisher_id=seeded["publisher"].id,
        title="Second Treatise",
        description="civil government essays",
        category_id=seeded["fiction"].id,
        created_at=now - timedelta(days=2),
    )
    locke.author_name = "John Locke"
    locke.author_hub_id = "locke"
    db_session.add_all([grotius_vi, grotius_en, locke])
    db_session.commit()

    payload = client.get(f"/api/books/{grotius_vi.id}/recommendations").json()
    same_ids = [book["id"] for book in payload["same_author"]]
    related_ids = [book["id"] for book in payload["related"]]
    assert same_ids == [grotius_en.id]
    assert locke.id not in same_ids
    assert locke.id in related_ids


def test_recommendations_404_for_hidden_non_manager(client, db_session, seeded):
    book = _book(
        publisher_id=seeded["publisher"].id,
        title="Hidden",
        visibility="hidden",
        category_id=seeded["fiction"].id,
    )
    db_session.add(book)
    db_session.commit()
    response = client.get(f"/api/books/{book.id}/recommendations")
    assert response.status_code == 404
