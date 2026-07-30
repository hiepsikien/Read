"""Canonical English category taxonomy for indie manuscripts."""

from nanoid import generate
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Category

CATEGORY_SEED: list[tuple[str, str]] = [
    ("fiction", "Fiction"),
    ("romance", "Romance"),
    ("fantasy", "Fantasy"),
    ("science-fiction", "Science Fiction"),
    ("mystery-thriller", "Mystery & Thriller"),
    ("horror", "Horror"),
    ("historical-fiction", "Historical Fiction"),
    ("literary-fiction", "Literary Fiction"),
    ("young-adult", "Young Adult"),
    ("poetry", "Poetry"),
    ("essays", "Essays"),
    ("memoir-biography", "Memoir & Biography"),
    ("self-help", "Self-Help"),
    ("business", "Business"),
    ("other", "Other"),
]


def ensure_categories(db: Session) -> list[Category]:
    existing = {
        row.slug: row
        for row in db.scalars(select(Category)).all()
    }
    created = False
    for index, (slug, label) in enumerate(CATEGORY_SEED):
        row = existing.get(slug)
        if row is None:
            row = Category(id=generate(), slug=slug, label=label, sort_order=index)
            db.add(row)
            existing[slug] = row
            created = True
        else:
            row.label = label
            row.sort_order = index
    if created:
        db.commit()
    return sorted(existing.values(), key=lambda item: item.sort_order)


def category_payload(category: Category | None) -> dict | None:
    if not category:
        return None
    return {
        "id": category.id,
        "slug": category.slug,
        "label": category.label,
    }
