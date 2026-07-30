from .models import Book, Chapter


def has_purchase(db_has_purchase: bool) -> bool:
    return db_has_purchase


def can_access_chapter(
    *,
    book: Book,
    chapter: Chapter,
    user_id: str | None,
    purchased: bool,
) -> bool:
    if book.price_cents == 0:
        return True
    if (chapter.group_index or 1) == 1:
        return True
    if not user_id:
        return False
    if book.publisher_id == user_id:
        return True
    return purchased
