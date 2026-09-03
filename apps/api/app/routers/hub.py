"""Knowledge Hub ingest — plain-text works, not DOCX publisher upload."""

from __future__ import annotations

import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import hash_password
from ..categories import ensure_categories
from ..chapters import count_words, split_into_chapters
from ..config import get_settings
from ..db import get_db
from ..glossary import aliases_to_storage, figures_to_storage, note_figures
from ..handles import normalize_handle
from ..credits import apply_credits
from ..explain import normalize_catalog_language
from ..media import media_url_for, save_media_bytes
from ..models import Book, Chapter, GlossaryEntry, User

logger = logging.getLogger(__name__)

MAX_HUB_ASSETS = 64

router = APIRouter(prefix="/api/internal/hub", tags=["hub"])


class HubGlossaryEntry(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    aliases: list[str] = Field(default_factory=list)
    summary: str = ""
    group_label: str = "Chú thích"
    kind: str = ""
    marker: str = ""
    anchor: str = ""
    chapter: str = ""
    host_block_id: str = ""
    host_text: str = ""
    figures: list[dict[str, Any]] = Field(default_factory=list)


class HubNote(BaseModel):
    id: str = ""
    kind: str = "footnote"
    label: str = Field(min_length=1, max_length=300)
    marker: str = ""
    anchor: str = ""
    chapter: str = ""
    body: str = ""
    group_label: str = "Chú thích"
    host_block_id: str = ""
    host_text: str = ""
    figures: list[dict[str, Any]] = Field(default_factory=list)


class HubSourceWork(BaseModel):
    hub_work_id: str = ""
    title: str = ""
    year: int | None = None
    language: str = ""


class HubCredits(BaseModel):
    author_name: str = ""
    author_hub_id: str = ""
    translator_name: str = ""
    translator_role: str = ""
    source: HubSourceWork | None = None


class HubChapterIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1)
    blocks: list[dict[str, Any]] | None = None
    word_count: int | None = None


class HubAsset(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = ""
    data: str = Field(min_length=1)


class HubWorkIn(BaseModel):
    hub_work_id: str = Field(min_length=3, max_length=120)
    hub_version: int = 1
    hub_content_hash: str | None = None
    title: str = Field(min_length=1, max_length=500)
    description: str = ""
    language: str = "en"
    license: str | None = None
    source_url: str = ""
    category_slug: str = "essays"
    price_cents: int = 0
    split_length: str = "standard"
    status: str = "pending_review"
    hub_license_snapshot: dict[str, Any] | None = None
    raw_text: str = Field(min_length=1)
    glossary: list[HubGlossaryEntry] | None = None
    notes: list[HubNote] | None = None
    credits: HubCredits | None = None
    # REF/1 pilot contract — KnowledgeHub docs/ref-read-contract.md
    edition_format: str | None = None
    edition_hash: str | None = None
    content_kind: str | None = None
    reading_markdown: str | None = None
    blocks: list[dict[str, Any]] | None = None
    split_hints: list[dict[str, Any]] | None = None
    quotation_profile: dict[str, Any] | None = None
    chapters: list[HubChapterIn] | None = None
    assets: list[HubAsset] | None = None


def _safe_asset_filename(name: str) -> str | None:
    raw = (name or "").strip()
    if not raw or "/" in raw or "\\" in raw or raw in {".", ".."}:
        return None
    cleaned = Path(raw).name
    if cleaned != raw:
        return None
    return cleaned


def _persist_hub_assets(book_id: str, assets: list[HubAsset] | None) -> dict[str, str]:
    """Save Hub illustrations; return original filename → Read media URL."""
    if not assets:
        return {}
    upload_dir = get_settings().upload_dir
    mapping: dict[str, str] = {}
    for item in assets[:MAX_HUB_ASSETS]:
        filename = _safe_asset_filename(item.filename)
        if not filename:
            continue
        try:
            raw = base64.b64decode(item.data)
        except (binascii.Error, ValueError):
            continue
        if not raw:
            continue
        try:
            asset_id = save_media_bytes(upload_dir, book_id, raw)
        except Exception:  # noqa: BLE001 — skip corrupt or unsupported bytes
            logger.warning("Hub asset %s for book %s could not be stored", filename, book_id)
            continue
        mapping[filename] = media_url_for(book_id, asset_id)
    return mapping


def _rewrite_src(src: str, mapping: dict[str, str]) -> str:
    if not src or not mapping:
        return src
    return mapping.get(Path(src).name, src)


def _rewrite_figure_dicts(
    figures: list[dict[str, Any]], mapping: dict[str, str]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for fig in figures:
        if not isinstance(fig, dict):
            out.append(fig)
            continue
        src = str(fig.get("src") or "")
        rewritten = _rewrite_src(src, mapping)
        if rewritten == src:
            out.append(fig)
            continue
        row = dict(fig)
        row["src"] = rewritten
        out.append(row)
    return out


def _rewrite_block_srcs(
    blocks: list[dict[str, Any]], mapping: dict[str, str]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict):
            out.append(block)
            continue
        src = str(block.get("src") or "")
        rewritten = _rewrite_src(src, mapping)
        if rewritten == src:
            out.append(block)
            continue
        row = dict(block)
        row["src"] = rewritten
        out.append(row)
    return out


def _rewrite_unit_block_srcs(units: list[dict[str, Any]], mapping: dict[str, str]) -> None:
    if not mapping:
        return
    for unit in units:
        raw_blocks = unit.get("blocks_json")
        if not raw_blocks:
            continue
        try:
            blocks = json.loads(raw_blocks)
        except json.JSONDecodeError:
            continue
        if not isinstance(blocks, list):
            continue
        unit["blocks_json"] = json.dumps(
            _rewrite_block_srcs(blocks, mapping), ensure_ascii=False
        )


def _notes_with_rewritten_srcs(
    notes: list[HubNote] | None, mapping: dict[str, str]
) -> list[HubNote] | None:
    if not notes or not mapping:
        return notes
    return [
        item.model_copy(update={"figures": _rewrite_figure_dicts(item.figures, mapping)})
        for item in notes
    ]


def _glossary_with_rewritten_srcs(
    entries: list[HubGlossaryEntry] | None, mapping: dict[str, str]
) -> list[HubGlossaryEntry] | None:
    if not entries or not mapping:
        return entries
    return [
        item.model_copy(update={"figures": _rewrite_figure_dicts(item.figures, mapping)})
        for item in entries
    ]


def _require_hub_token(x_hub_sync_token: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().hub_sync_token.strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Hub sync is not configured.")
    if not x_hub_sync_token or x_hub_sync_token != expected:
        raise HTTPException(status_code=401, detail="Invalid hub sync token.")


def _hub_publisher(db: Session) -> User:
    email = "knowledgehub@read.app"
    user = db.scalar(select(User).where(User.email == email))
    if user:
        if user.role == "reader":
            user.role = "publisher"
        return user
    now = datetime.now(timezone.utc)
    user_id = generate()
    base = normalize_handle("knowledgehub") or "knowledgehub"
    handle = base[:30]
    suffix = 0
    while db.scalar(select(User).where(User.handle == handle)):
        suffix += 1
        stem = base[: max(1, 30 - len(str(suffix)) - 1)]
        handle = f"{stem}{suffix}"
    user = User(
        id=user_id,
        firebase_uid=f"hub-{user_id}",
        email=email,
        name="Knowledge Hub",
        handle=handle,
        role="publisher",
        password_hash=hash_password("hub-sync-disabled-login"),
        created_at=now,
    )
    db.add(user)
    db.flush()
    return user


def _notes_as_glossary(notes: list[HubNote]) -> list[HubGlossaryEntry]:
    rows: list[HubGlossaryEntry] = []
    for item in notes:
        aliases = [item.marker.strip()] if item.marker.strip() and item.marker.strip() != item.label else []
        if item.kind != "footnote" and item.anchor.strip() and item.anchor.strip() != item.label:
            aliases.append(item.anchor.strip())
        rows.append(
            HubGlossaryEntry(
                name=item.label.strip()[:300],
                aliases=aliases[:12],
                summary=(item.body or "")[:8000],
                group_label=(item.group_label or "Chú thích")[:200],
                kind=item.kind,
                marker=item.marker.strip(),
                anchor=item.anchor.strip(),
                chapter=item.chapter.strip(),
                host_block_id=(item.host_block_id or "").strip()[:128],
                host_text=(item.host_text or "").strip()[:4000],
                figures=note_figures(item.figures),
            )
        )
    return rows


def _upsert_hub_glossary(
    db: Session,
    book: Book,
    entries: list[HubGlossaryEntry] | None,
    notes: list[HubNote] | None = None,
) -> int:
    if notes is not None:
        entries = _notes_as_glossary(notes)
    elif entries is None:
        return -1
    now = datetime.now(timezone.utc)
    db.execute(delete(GlossaryEntry).where(GlossaryEntry.book_id == book.id))
    for item in entries:
        aliases = [a.strip() for a in item.aliases if str(a).strip()][:12]
        marker = (item.marker or "").strip()
        if marker and marker not in aliases and marker != item.name.strip():
            aliases.insert(0, marker)
        db.add(
            GlossaryEntry(
                id=generate(),
                book_id=book.id,
                episode_key=(item.chapter or "")[:32],
                episode_title=(item.anchor or "")[:300],
                group_label=(item.group_label or "Chú thích")[:200],
                name=item.name.strip()[:300],
                aliases=aliases_to_storage(aliases),
                summary=(item.summary or "")[:8000],
                host_block_id=(item.host_block_id or "").strip()[:128],
                host_text=(item.host_text or "").strip()[:4000],
                figures_json=figures_to_storage(item.figures),
                sort_key=item.name.casefold()[:300],
                gender="",
                age_band="",
                presence="",
                tts_voice="",
                cast_locked=True,
                created_at=now,
                updated_at=now,
            )
        )
    return len(entries)


@router.post("/works")
def create_hub_work(
    body: HubWorkIn,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_hub_token)],
) -> dict[str, Any]:
    if body.status not in {"draft", "pending_review", "published"}:
        raise HTTPException(status_code=400, detail="Invalid status.")

    edition_hash = (body.edition_hash or "").strip() or None
    if edition_hash:
        existing = db.scalar(
            select(Book)
            .where(Book.hub_work_id == body.hub_work_id, Book.edition_hash == edition_hash)
            .order_by(Book.created_at.desc())
        )
        if existing is not None:
            return {
                "id": existing.id,
                "hub_work_id": body.hub_work_id,
                "created": False,
                "unchanged": True,
                "chapter_count": len(existing.chapters),
                "glossary_count": len(existing.glossary_entries),
                "status": existing.status,
                "edition_format": existing.edition_format,
                "used_hub_chapters": any(ch.hub_chapter_id for ch in existing.chapters),
            }

    categories = ensure_categories(db)
    category = next((c for c in categories if c.slug == body.category_slug), None)
    if not category:
        category = next((c for c in categories if c.slug == "other"), categories[0])
    publisher = _hub_publisher(db)
    now = datetime.now(timezone.utc)
    hub_chapters = list(body.chapters or [])
    if hub_chapters:
        units = [
            {
                "title": ch.title,
                "content": ch.content,
                "word_count": ch.word_count if ch.word_count is not None else count_words(ch.content),
                "group_index": 1,
                "hub_chapter_id": ch.id,
                "blocks_json": json.dumps(ch.blocks, ensure_ascii=False) if ch.blocks else None,
            }
            for ch in hub_chapters
        ]
    else:
        split_units = split_into_chapters(
            body.raw_text, preserve_paragraphs=True, length=body.split_length
        )
        if not split_units:
            raise HTTPException(status_code=400, detail="Could not split manuscript into chapters.")
        units = [
            {
                "title": unit.title,
                "content": unit.content,
                "word_count": count_words(unit.content),
                "group_index": unit.group_index,
                "hub_chapter_id": None,
                "blocks_json": None,
            }
            for unit in split_units
        ]

    raw_text = (body.reading_markdown or body.raw_text).strip() or body.raw_text
    book = Book(
        id=generate(),
        publisher_id=publisher.id,
        category_id=category.id,
        title=body.title,
        description=body.description or body.title,
        price_cents=max(0, body.price_cents),
        status=body.status,
        source_filename=f"{body.hub_work_id}.txt",
        raw_text=raw_text,
        hub_work_id=body.hub_work_id,
        hub_version=body.hub_version,
        hub_content_hash=body.hub_content_hash,
        hub_license_snapshot=json.dumps(body.hub_license_snapshot or {}, ensure_ascii=False),
        edition_format=body.edition_format,
        edition_hash=edition_hash,
        content_kind=body.content_kind,
        language=normalize_catalog_language(body.language),
        submitted_at=now if body.status == "pending_review" else None,
        created_at=now,
        updated_at=now,
    )
    db.add(book)
    db.flush()
    url_by_filename = _persist_hub_assets(book.id, body.assets)
    _rewrite_unit_block_srcs(units, url_by_filename)
    for index, unit in enumerate(units):
        db.add(
            Chapter(
                id=generate(),
                book_id=book.id,
                position=index + 1,
                title=unit["title"],
                content=unit["content"],
                word_count=unit["word_count"],
                group_index=unit["group_index"],
                hub_chapter_id=unit["hub_chapter_id"],
                blocks_json=unit["blocks_json"],
            )
        )
    glossary_count = _upsert_hub_glossary(
        db,
        book,
        _glossary_with_rewritten_srcs(body.glossary, url_by_filename),
        _notes_with_rewritten_srcs(body.notes, url_by_filename),
    )
    if body.credits is not None:
        apply_credits(book, body.credits.model_dump())
    if not str(getattr(book, "source_language", "") or "").strip():
        book.source_language = (body.language or "en").strip()[:16]
    db.commit()
    return {
        "id": book.id,
        "hub_work_id": body.hub_work_id,
        "created": True,
        "unchanged": False,
        "chapter_count": len(units),
        "glossary_count": 0 if glossary_count < 0 else glossary_count,
        "status": book.status,
        "edition_format": book.edition_format,
        "used_hub_chapters": bool(hub_chapters),
    }
