"""Shared moderation audit and action-policy helpers."""

import json
from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from .models import Book, ModerationEvent, User


def allowed_admin_actions(book: Book) -> list[str]:
    if book.status == "pending_review":
        return ["approve", "approve_featured", "reject"]
    if book.status != "published":
        return []
    if book.visibility == "listed":
        return [
            "unfeature" if book.featured else "feature",
            "hide",
            "remove",
        ]
    if book.visibility == "hidden":
        return ["relist", "remove"]
    return []


def record_moderation_event(
    db: Session,
    *,
    book: Book,
    actor: User | None,
    action: str,
    from_status: str | None = None,
    to_status: str | None = None,
    from_visibility: str | None = None,
    to_visibility: str | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> ModerationEvent:
    event = ModerationEvent(
        id=generate(),
        book_id=book.id,
        actor_id=actor.id if actor else None,
        action=action,
        from_status=from_status,
        to_status=to_status,
        from_visibility=from_visibility,
        to_visibility=to_visibility,
        note=note,
        payload_json=json.dumps(payload or {}, ensure_ascii=False),
        created_at=datetime.now(timezone.utc),
    )
    db.add(event)
    return event


def event_payload(event: ModerationEvent) -> dict:
    try:
        payload = json.loads(event.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    return {
        "id": event.id,
        "action": event.action,
        "actor_id": event.actor_id,
        "from_status": event.from_status,
        "to_status": event.to_status,
        "from_visibility": event.from_visibility,
        "to_visibility": event.to_visibility,
        "note": event.note,
        "payload": payload,
        "created_at": event.created_at.isoformat(),
    }
