from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from nanoid import generate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password, mint_dev_id_token
from app.db import Base, get_db
from app.legal import CURRENT_LEGAL_VERSION
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
    reader = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="reader@example.com",
        name="Reader",
        handle="reader_one",
        role="reader",
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
        handle="pub_one",
        role="publisher",
        password_hash=hash_password("password123"),
        accepted_legal_version=CURRENT_LEGAL_VERSION,
        accepted_legal_at=now,
        created_at=now,
    )
    db_session.add_all([admin, reader, publisher])
    db_session.commit()
    return {"admin": admin, "reader": reader, "publisher": publisher}


def auth_header(user: User) -> dict[str, str]:
    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"Authorization": f"Bearer {token}"}


def test_admin_list_users(client, seeded):
    response = client.get("/api/admin/users", headers=auth_header(seeded["admin"]))
    assert response.status_code == 200
    users = response.json()["users"]
    emails = {u["email"] for u in users}
    assert "reader@example.com" in emails
    assert "publisher@example.com" in emails


def test_admin_list_users_search(client, seeded):
    response = client.get(
        "/api/admin/users?q=reader_one",
        headers=auth_header(seeded["admin"]),
    )
    assert response.status_code == 200
    users = response.json()["users"]
    assert len(users) == 1
    assert users[0]["handle"] == "reader_one"


def test_admin_patch_user_role(client, seeded):
    reader_id = seeded["reader"].id
    response = client.patch(
        f"/api/admin/users/{reader_id}",
        headers=auth_header(seeded["admin"]),
        json={"role": "publisher"},
    )
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "publisher"


def test_admin_cannot_patch_admin_role(client, seeded):
    response = client.patch(
        f"/api/admin/users/{seeded['admin'].id}",
        headers=auth_header(seeded["admin"]),
        json={"role": "reader"},
    )
    assert response.status_code == 400


def test_non_admin_cannot_list_users(client, seeded):
    response = client.get("/api/admin/users", headers=auth_header(seeded["publisher"]))
    assert response.status_code == 403
