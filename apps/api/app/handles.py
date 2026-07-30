from __future__ import annotations

import re

from fastapi import HTTPException

HANDLE_MIN_LENGTH = 3
HANDLE_MAX_LENGTH = 30
HANDLE_RE = re.compile(rf"^[a-z0-9_]{{{HANDLE_MIN_LENGTH},{HANDLE_MAX_LENGTH}}}$")

RESERVED_HANDLES = frozenset(
    {
        "about",
        "admin",
        "api",
        "assets",
        "books",
        "claim-handle",
        "health",
        "help",
        "legal",
        "login",
        "me",
        "null",
        "publisher",
        "read",
        "settings",
        "static",
        "support",
        "undefined",
        "www",
    }
)


def normalize_handle(raw: str) -> str:
    return raw.strip().lstrip("@").lower()


def validate_handle(raw: str) -> str:
    handle = normalize_handle(raw)
    if not HANDLE_RE.fullmatch(handle):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Handle must be {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} characters "
                "using lowercase letters, numbers, or underscores."
            ),
        )
    if handle in RESERVED_HANDLES:
        raise HTTPException(status_code=400, detail="That handle is reserved.")
    return handle


def parse_public_handle_segment(segment: str) -> str | None:
    """Return a normalized handle when the URL segment is `@handle`, else None."""
    if not segment.startswith("@") or len(segment) < 2:
        return None
    candidate = normalize_handle(segment)
    if not HANDLE_RE.fullmatch(candidate):
        return None
    return candidate
