from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from nanoid import generate
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password, mint_dev_id_token
from app.db import Base, get_db
from app.glossary import aliases_to_storage
from app.main import app
from app.legal import CURRENT_LEGAL_VERSION
from app.models import Book, Chapter, GlossaryEntry, Series, User


SAMPLE = """
VASCO *(khẽ)* Chúng ta đi tiếp.

AFONSO Đừng chậm bước.

UNKNOWN *(to)* Ai đó?
"""


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
    now = datetime.now(timezone.utc)
    admin = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="admin@example.com",
        name="Admin",
        role="admin",
        password_hash=hash_password("password123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    publisher = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="publisher@example.com",
        name="Publisher",
        handle="pub_cast",
        role="publisher",
        password_hash=hash_password("password123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        title="Cast Book",
        description="Dialogue sample",
        price_cents=0,
        status="pending_review",
        cast_status="draft",
        cast_overrides="{}",
        created_at=now,
        updated_at=now,
        submitted_at=now,
    )
    chapter = Chapter(
        id=generate(),
        book_id=book.id,
        position=1,
        title="One",
        content=SAMPLE,
        word_count=20,
        group_index=0,
    )
    vasco = GlossaryEntry(
        id=generate(),
        book_id=book.id,
        name="Vasco da Gama",
        aliases=aliases_to_storage(["Vasco"]),
        episode_key="S1E1",
        group_label="Nhân vật",
        summary="Nhà thám hiểm Bồ Đào Nha.",
        sort_key="vasco",
        gender="male",
        age_band="adult",
        presence="neutral",
        tts_voice="vi-VN-Chirp3-HD-Puck",
        cast_locked=False,
        created_at=now,
        updated_at=now,
    )
    afonso = GlossaryEntry(
        id=generate(),
        book_id=book.id,
        name="Afonso de Albuquerque",
        aliases="[]",
        episode_key="S1E1",
        group_label="Nhân vật",
        summary="Đô đốc Bồ Đào Nha.",
        sort_key="afonso",
        gender="male",
        age_band="elder",
        presence="forceful",
        tts_voice="vi-VN-Chirp3-HD-Charon",
        cast_locked=False,
        created_at=now,
        updated_at=now,
    )
    silent = GlossaryEntry(
        id=generate(),
        book_id=book.id,
        name="Công chúa An Vi",
        aliases="[]",
        episode_key="S1E1",
        group_label="Nhân vật",
        summary="Công chúa nhà Lê.",
        sort_key="anvi",
        gender="female",
        age_band="youth",
        presence="soft",
        tts_voice="vi-VN-Chirp3-HD-Zephyr",
        cast_locked=False,
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([admin, publisher, book, chapter, vasco, afonso, silent])
    db_session.commit()
    return {
        "admin": admin,
        "book": book,
        "vasco": vasco,
        "afonso": afonso,
        "silent": silent,
    }


def auth_header(user: User) -> dict[str, str]:
    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"Authorization": f"Bearer {token}"}


def test_admin_cast_speaking_scope_excludes_silent_glossary(client, seeded):
    response = client.get(
        f"/api/admin/books/{seeded['book'].id}/cast?scope=speaking",
        headers=auth_header(seeded["admin"]),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["speaking_count"] == 3
    assert data["unmatched_count"] == 1
    assert data["cast_status"] == "draft"
    names = [entry["name"] for entry in data["entries"]]
    assert "Vasco da Gama" in names
    assert "Afonso de Albuquerque" in names
    assert "Unknown" in names
    assert "Công chúa An Vi" not in names
    assert any(entry["source"] == "unmatched" for entry in data["entries"])
    assert "Audio cast is not marked ready." in data["warnings"]


def test_admin_cast_all_scope_includes_glossary_only(client, seeded):
    response = client.get(
        f"/api/admin/books/{seeded['book'].id}/cast?scope=all",
        headers=auth_header(seeded["admin"]),
    )
    assert response.status_code == 200
    names = {entry["name"] for entry in response.json()["entries"]}
    assert "Công chúa An Vi" in names


def test_admin_set_cast_status_ready(client, seeded):
    response = client.post(
        f"/api/admin/books/{seeded['book'].id}/cast/status",
        headers=auth_header(seeded["admin"]),
        json={"status": "ready"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["cast_status"] == "ready"
    assert any("unmatched" in warning.lower() for warning in body["warnings"])


def test_admin_approve_returns_cast_warnings(client, seeded, db_session):
    response = client.post(
        f"/api/admin/books/{seeded['book'].id}/approve",
        headers=auth_header(seeded["admin"]),
        json={"featured": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["status"] == "published"
    assert "Audio cast is not marked ready." in body["warnings"]
    db_session.refresh(seeded["book"])
    assert seeded["book"].status == "published"


def test_admin_cast_get_prefers_locked_name_override_over_stale_cue(client, seeded, db_session):
    import json

    afonso = seeded["afonso"]
    afonso.cast_locked = True
    afonso.tts_voice = "vi-VN-Chirp3-HD-Algieba"
    seeded["book"].cast_overrides = json.dumps(
        {
            "afonso": {
                "gender": "male",
                "age_band": "elder",
                "presence": "forceful",
                "tts_voice": "vi-VN-Chirp3-HD-Puck",
                "cast_locked": False,
            },
            "afonso de albuquerque": {
                "gender": "male",
                "age_band": "elder",
                "presence": "forceful",
                "tts_voice": "vi-VN-Chirp3-HD-Algieba",
                "cast_locked": True,
            },
        }
    )
    db_session.commit()

    response = client.get(
        f"/api/admin/books/{seeded['book'].id}/cast?scope=speaking",
        headers=auth_header(seeded["admin"]),
    )
    assert response.status_code == 200
    afonso_row = next(e for e in response.json()["entries"] if e["id"] == afonso.id)
    assert afonso_row["speaker_key"] == "afonso"
    assert afonso_row["cast_locked"] is True
    assert afonso_row["tts_voice"] == "vi-VN-Chirp3-HD-Algieba"


def test_admin_cast_lock_save_applies_to_short_speaker_cue(client, seeded, db_session):
    """Cue AFONSO matches glossary Afonso de Albuquerque; lock must stick on cue key."""
    import json

    afonso = seeded["afonso"]
    # Stale cue-keyed override (unlocked) that previously shadowed glossary saves.
    seeded["book"].cast_overrides = json.dumps(
        {
            "afonso": {
                "gender": "male",
                "age_band": "elder",
                "presence": "forceful",
                "tts_voice": "vi-VN-Chirp3-HD-Puck",
                "cast_locked": False,
            }
        }
    )
    db_session.commit()

    response = client.put(
        f"/api/admin/books/{seeded['book'].id}/cast",
        headers=auth_header(seeded["admin"]),
        json={
            "entries": [
                {
                    "id": afonso.id,
                    "speaker_key": "afonso",
                    "gender": "male",
                    "age_band": "elder",
                    "presence": "forceful",
                    "tts_voice": "vi-VN-Chirp3-HD-Algieba",
                    "cast_locked": True,
                }
            ]
        },
    )
    assert response.status_code == 200

    db_session.refresh(seeded["book"])
    db_session.refresh(afonso)
    overrides = json.loads(seeded["book"].cast_overrides)
    assert overrides["afonso"]["cast_locked"] is True
    assert overrides["afonso"]["tts_voice"] == "vi-VN-Chirp3-HD-Algieba"
    assert overrides["afonso de albuquerque"]["cast_locked"] is True
    assert overrides["afonso de albuquerque"]["tts_voice"] == "vi-VN-Chirp3-HD-Algieba"
    assert afonso.cast_locked is True
    assert afonso.tts_voice == "vi-VN-Chirp3-HD-Algieba"

    after = client.get(
        f"/api/admin/books/{seeded['book'].id}/cast?scope=speaking",
        headers=auth_header(seeded["admin"]),
    )
    assert after.status_code == 200
    afonso_row = next(e for e in after.json()["entries"] if e["id"] == afonso.id)
    assert afonso_row["cast_locked"] is True
    assert afonso_row["tts_voice"] == "vi-VN-Chirp3-HD-Algieba"


def test_admin_cast_import_from_sibling_episode(client, seeded, db_session):
    now = datetime.now(timezone.utc)
    publisher_id = seeded["book"].publisher_id
    series = Series(
        id=generate(),
        publisher_id=publisher_id,
        title="Đại Lộ Đại Dương",
        description="",
        created_at=now,
        updated_at=now,
    )
    source = seeded["book"]
    source.series_id = series.id
    source.season_number = 1
    source.episode_number = 1
    source.cast_status = "ready"
    seeded["vasco"].cast_locked = True
    seeded["vasco"].tts_voice = "vi-VN-Chirp3-HD-Algieba"
    seeded["afonso"].cast_locked = True
    seeded["afonso"].tts_voice = "vi-VN-Chirp3-HD-Charon"

    target = Book(
        id=generate(),
        publisher_id=publisher_id,
        title="Cast Book Ep2",
        description="Episode 2",
        price_cents=0,
        status="pending_review",
        cast_status="draft",
        cast_overrides="{}",
        series_id=series.id,
        season_number=1,
        episode_number=2,
        created_at=now,
        updated_at=now,
        submitted_at=now,
    )
    target_vasco = GlossaryEntry(
        id=generate(),
        book_id=target.id,
        name="Vasco",
        aliases="[]",
        episode_key="S1E2",
        group_label="Nhân vật",
        summary="Nhà thám hiểm.",
        sort_key="vasco",
        gender="male",
        age_band="adult",
        presence="neutral",
        tts_voice="vi-VN-Chirp3-HD-Puck",
        cast_locked=False,
        created_at=now,
        updated_at=now,
    )
    target_new = GlossaryEntry(
        id=generate(),
        book_id=target.id,
        name="Nhân vật mới",
        aliases="[]",
        episode_key="S1E2",
        group_label="Nhân vật",
        summary="Xuất hiện ở ep2.",
        sort_key="nhanvatmoi",
        gender="female",
        age_band="youth",
        presence="soft",
        tts_voice="vi-VN-Chirp3-HD-Zephyr",
        cast_locked=False,
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([series, target, target_vasco, target_new])
    db_session.commit()

    listed = client.get(
        f"/api/admin/books/{target.id}/cast?scope=all",
        headers=auth_header(seeded["admin"]),
    )
    assert listed.status_code == 200
    sources = listed.json()["import_sources"]
    assert len(sources) == 1
    assert sources[0]["id"] == source.id
    assert sources[0]["episode_number"] == 1

    db_session.refresh(target_new)
    new_voice_before = target_new.tts_voice

    response = client.post(
        f"/api/admin/books/{target.id}/cast/import-from",
        headers=auth_header(seeded["admin"]),
        json={"source_book_id": source.id},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["matched"] == 1
    assert body["unmatched"] == 1
    assert body["updated"] == 1
    assert body["carried"] >= 2  # Afonso + An Vi from ep1, not on target
    assert body["cast_status"] == "draft"

    db_session.refresh(target_vasco)
    db_session.refresh(target_new)
    assert target_vasco.tts_voice == "vi-VN-Chirp3-HD-Algieba"
    assert target_vasco.cast_locked is True
    assert target_new.tts_voice == new_voice_before
    assert target_new.cast_locked is False

    carried_names = {
        row.name
        for row in db_session.scalars(
            select(GlossaryEntry).where(GlossaryEntry.book_id == target.id)
        )
    }
    assert "Afonso de Albuquerque" in carried_names
    assert "Công chúa An Vi" in carried_names

    rejected = client.post(
        f"/api/admin/books/{target.id}/cast/import-from",
        headers=auth_header(seeded["admin"]),
        json={"source_book_id": generate()},
    )
    assert rejected.status_code == 404
