from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import (
    get_current_user,
    get_current_user_optional,
    hash_password,
    mint_dev_id_token,
    resolve_role_for_email,
    session_user,
    verify_password,
)
from ..config import get_settings
from ..db import get_db
from ..legal import CURRENT_LEGAL_VERSION, require_current_legal_acceptance
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class DevLoginBody(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)
    name: str | None = None


class EnableAuthorBody(BaseModel):
    enabled: bool = True


class AcceptLegalBody(BaseModel):
    version: str = Field(min_length=1, max_length=32)


@router.post("/dev-login")
def dev_login(body: DevLoginBody, db: Annotated[Session, Depends(get_db)]):
    """Local stand-in for Firebase email/password when AUTH_DEV_MODE is enabled."""
    settings = get_settings()
    if settings.firebase_enabled or not settings.auth_dev_mode:
        raise HTTPException(
            status_code=404,
            detail="Dev login is disabled when Firebase is configured.",
        )

    email = body.email.strip().lower()
    password = body.password
    name = (body.name or "").strip() or email.split("@")[0]
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required.")

    user = db.query(User).filter(User.email == email).one_or_none()
    if user and user.password_hash:
        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        uid = user.firebase_uid or f"dev-{user.id}"
        user.firebase_uid = uid
        if name and not user.name:
            user.name = name
        user.role = resolve_role_for_email(email, user.role)
        db.commit()
        db.refresh(user)
    elif user:
        raise HTTPException(
            status_code=401,
            detail="This account has no local password. Use Firebase Auth.",
        )
    else:
        uid = f"dev-{generate()}"
        user = User(
            id=generate(),
            firebase_uid=uid,
            email=email,
            name=name,
            role=resolve_role_for_email(email),
            password_hash=hash_password(password),
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"user": session_user(user), "token": token}


@router.post("/logout")
def logout():
    return {"ok": True}


@router.get("/me")
def me(user: Annotated[User | None, Depends(get_current_user_optional)]):
    return {"user": session_user(user) if user else None}


@router.post("/enable-author")
def enable_author(
    body: EnableAuthorBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    if user.role == "admin":
        return {"user": session_user(user)}
    if body.enabled:
        require_current_legal_acceptance(user)
    user.role = "publisher" if body.enabled else "reader"
    db.commit()
    db.refresh(user)
    return {"user": session_user(user)}


@router.post("/accept-legal")
def accept_legal(
    body: AcceptLegalBody,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    if body.version != CURRENT_LEGAL_VERSION:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "terms_required",
                "message": "This policy version is no longer current.",
                "current_legal_version": CURRENT_LEGAL_VERSION,
            },
        )
    user.accepted_legal_version = CURRENT_LEGAL_VERSION
    user.accepted_legal_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return {"ok": True, "user": session_user(user)}
