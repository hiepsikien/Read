"""Versioned legal acceptance shared by auth and publishing policies."""

from fastapi import HTTPException

from .models import User

CURRENT_LEGAL_VERSION = "2026-07-30"


def has_current_legal_acceptance(user: User) -> bool:
    return user.accepted_legal_version == CURRENT_LEGAL_VERSION


def legal_status_payload(user: User) -> dict:
    return {
        "accepted_legal_version": user.accepted_legal_version,
        "accepted_legal_at": (
            user.accepted_legal_at.isoformat() if user.accepted_legal_at else None
        ),
        "current_legal_version": CURRENT_LEGAL_VERSION,
        "needs_legal_acceptance": not has_current_legal_acceptance(user),
    }


def require_current_legal_acceptance(user: User) -> None:
    if has_current_legal_acceptance(user):
        return
    raise HTTPException(
        status_code=403,
        detail={
            "error": "terms_required",
            "message": "Please accept the current Terms and Privacy Policy.",
            "current_legal_version": CURRENT_LEGAL_VERSION,
        },
    )
