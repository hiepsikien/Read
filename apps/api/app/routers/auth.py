from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import (
    create_access_token,
    get_current_user_optional,
    session_user,
    verify_password,
)
from ..db import get_db
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)


@router.post("/login")
def login(body: LoginBody, db: Annotated[Session, Depends(get_db)]):
    email = body.email.strip().lower()
    password = body.password
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required.")

    user = db.query(User).filter(User.email == email).one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token(user)
    return {"user": session_user(user), "token": token}


@router.post("/logout")
def logout():
    return {"ok": True}


@router.get("/me")
def me(user: Annotated[User | None, Depends(get_current_user_optional)]):
    return {"user": session_user(user) if user else None}
