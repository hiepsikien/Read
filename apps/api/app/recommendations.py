"""Score and rank related books for catalog discovery (v1)."""

from __future__ import annotations

import re
from datetime import datetime

from .models import Book

RECOMMEND_LIMIT = 8

_TOKEN_RE = re.compile(r"[a-z0-9àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+", re.I)

_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "to",
        "in",
        "on",
        "for",
        "with",
        "is",
        "are",
        "was",
        "were",
        "be",
        "by",
        "from",
        "at",
        "as",
        "it",
        "this",
        "that",
        "một",
        "các",
        "và",
        "của",
        "cho",
        "với",
        "trong",
        "là",
        "những",
        "được",
        "có",
        "không",
        "về",
        "như",
        "khi",
        "này",
        "đó",
    }
)


def tokenize(text: str) -> set[str]:
    tokens = {m.group(0).casefold() for m in _TOKEN_RE.finditer(text or "")}
    return {t for t in tokens if len(t) > 1 and t not in _STOPWORDS}


def text_overlap_score(source: set[str], candidate: set[str]) -> float:
    """Jaccard overlap scaled to 0–20."""
    if not source or not candidate:
        return 0.0
    union = source | candidate
    if not union:
        return 0.0
    return (len(source & candidate) / len(union)) * 20.0


def related_score(
    *,
    source: Book,
    candidate: Book,
    source_tokens: set[str],
    candidate_tokens: set[str],
) -> float:
    score = 0.0
    if source.category_id and candidate.category_id == source.category_id:
        score += 40.0
    score += text_overlap_score(source_tokens, candidate_tokens)
    if candidate.featured:
        score += 5.0
    return score


def same_author_criterion(book: Book):
    """Match other books by Hub author id, then stored name, then publisher (indie)."""
    hub_id = str(book.author_hub_id or "").strip()
    if hub_id:
        return Book.author_hub_id == hub_id
    name = str(book.author_name or "").strip()
    if name:
        return Book.author_name == name
    return Book.publisher_id == book.publisher_id


def sort_same_author(books: list[Book]) -> list[Book]:
    return sorted(
        books,
        key=lambda b: (
            0 if b.featured else 1,
            -(b.created_at.timestamp() if isinstance(b.created_at, datetime) else 0),
        ),
    )


def rank_related(
    *,
    source: Book,
    candidates: list[Book],
    exclude_ids: set[str],
    limit: int = RECOMMEND_LIMIT,
) -> list[Book]:
    source_tokens = tokenize(f"{source.title} {source.description}")
    scored: list[tuple[float, datetime | None, Book]] = []
    for book in candidates:
        if book.id in exclude_ids:
            continue
        tokens = tokenize(f"{book.title} {book.description}")
        score = related_score(
            source=source,
            candidate=book,
            source_tokens=source_tokens,
            candidate_tokens=tokens,
        )
        scored.append((score, book.created_at, book))
    scored.sort(
        key=lambda row: (
            -row[0],
            -(row[1].timestamp() if isinstance(row[1], datetime) else 0),
        )
    )
    return [book for _, _, book in scored[:limit]]
