"""Bibliographic credits on a book. Empty on indie uploads; filled by Hub ingest."""

from __future__ import annotations

from typing import Any


def empty_credits() -> dict[str, Any]:
    return {
        "author_name": "",
        "author_hub_id": "",
        "translator_name": "",
        "translator_role": "",
        "source": None,
    }


def normalize_credits(raw: dict[str, Any] | None) -> dict[str, Any]:
    data = empty_credits()
    if not raw:
        return data
    data["author_name"] = str(raw.get("author_name") or "").strip()[:255]
    data["author_hub_id"] = str(raw.get("author_hub_id") or "").strip()[:80]
    data["translator_name"] = str(raw.get("translator_name") or "").strip()[:255]
    data["translator_role"] = str(raw.get("translator_role") or "").strip()[:64]
    source = raw.get("source")
    if isinstance(source, dict) and (
        str(source.get("hub_work_id") or "").strip() or str(source.get("title") or "").strip()
    ):
        year = source.get("year")
        try:
            year_int = int(year) if year not in (None, "") else None
        except (TypeError, ValueError):
            year_int = None
        data["source"] = {
            "hub_work_id": str(source.get("hub_work_id") or "").strip()[:120],
            "title": str(source.get("title") or "").strip()[:500],
            "year": year_int,
            "language": str(source.get("language") or "").strip()[:16],
        }
    return data


def apply_credits(book: Any, raw: dict[str, Any] | None) -> None:
    credits = normalize_credits(raw)
    book.author_name = credits["author_name"]
    book.author_hub_id = credits["author_hub_id"]
    book.translator_name = credits["translator_name"]
    book.translator_role = credits["translator_role"]
    source = credits["source"] or {}
    book.source_hub_work_id = str(source.get("hub_work_id") or "")
    book.source_title = str(source.get("title") or "")
    book.source_year = source.get("year")
    book.source_language = str(source.get("language") or "")


def display_author_name(book: Any, publisher_name: str = "") -> str:
    stored = str(getattr(book, "author_name", "") or "").strip()
    if stored:
        return stored
    if publisher_name.strip():
        return publisher_name.strip()
    publisher = getattr(book, "publisher", None)
    return str(getattr(publisher, "name", "") or "").strip()


def credits_payload(book: Any, *, publisher_name: str = "") -> dict[str, Any]:
    author = display_author_name(book, publisher_name)
    source = None
    hub_id = str(getattr(book, "source_hub_work_id", "") or "").strip()
    title = str(getattr(book, "source_title", "") or "").strip()
    if hub_id or title:
        source = {
            "hub_work_id": hub_id,
            "title": title,
            "year": getattr(book, "source_year", None),
            "language": str(getattr(book, "source_language", "") or "").strip(),
        }
    return {
        "author_name": author,
        "author_hub_id": str(getattr(book, "author_hub_id", "") or "").strip(),
        "translator_name": str(getattr(book, "translator_name", "") or "").strip(),
        "translator_role": str(getattr(book, "translator_role", "") or "").strip(),
        "source": source,
    }
