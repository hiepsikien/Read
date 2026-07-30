from app.access import can_access_chapter
from app.chapters import count_words, split_into_chapters
from app.models import Book, Chapter


def para(words: int, seed: str = "word") -> str:
    return " ".join(f"{seed}{i}" for i in range(words))


def test_keeps_existing_chapters_and_does_not_tear_section():
    text = "\n".join(
        [
            "Chapter 1 — Arrival",
            "",
            "Section 1 — Harbor",
            "",
            para(200, "harbor"),
            "",
            "Section 2 — Lanterns",
            "",
            para(200, "lantern"),
            "",
            "Section 3 — Fog",
            "",
            para(200, "fog"),
            "",
            "Section 4 — Tide",
            "",
            para(200, "tide"),
            "",
            "Section 5 — Letters",
            "",
            para(200, "letter"),
            "",
            "Chapter 2 — Departure",
            "",
            "Section 1 — Ticket",
            "",
            para(180, "ticket"),
            "",
            "Section 2 — Wake",
            "",
            para(180, "wake"),
        ]
    )

    units = split_into_chapters(text)
    assert len(units) >= 3

    chapter1 = [u for u in units if u.group_index == 1]
    chapter2 = [u for u in units if u.group_index == 2]
    assert len(chapter1) >= 2
    assert len(chapter2) == 1

    for marker in [
        "Section 1 — Harbor",
        "Section 2 — Lanterns",
        "Section 3 — Fog",
        "Section 4 — Tide",
        "Section 5 — Letters",
    ]:
        hits = [u for u in units if marker in u.content]
        assert len(hits) == 1

    assert all(u.group_index == 1 for u in chapter1)


def test_oversized_section_splits_on_paragraph_boundaries_only():
    unique_a = "ALPHA_UNIQUE_MARKER " + para(500, "alpha")
    unique_b = "BETA_UNIQUE_MARKER " + para(500, "beta")
    unique_c = "GAMMA_UNIQUE_MARKER " + para(500, "gamma")
    text = "\n".join(
        [
            "Chapter 1 — Long Form",
            "",
            "Section 1 — Dense",
            "",
            unique_a,
            "",
            unique_b,
            "",
            unique_c,
        ]
    )
    units = split_into_chapters(text)
    assert len(units) >= 2
    for marker in ["ALPHA_UNIQUE_MARKER", "BETA_UNIQUE_MARKER", "GAMMA_UNIQUE_MARKER"]:
        hits = [u for u in units if marker in u.content]
        assert len(hits) == 1
    assert all(u.group_index == 1 for u in units)
    assert all(count_words(u.content) > 0 for u in units)


def test_numbered_headings_become_logical_chapters():
    text = "\n".join(
        [
            "1. Beginnings",
            "",
            para(120, "begin"),
            "",
            "2. Middles",
            "",
            para(120, "middle"),
            "",
            "3. Endings",
            "",
            para(120, "end"),
        ]
    )
    units = split_into_chapters(text)
    assert len(units) == 3
    assert [u.group_index for u in units] == [1, 2, 3]
    assert "Beginnings" in units[0].title


def test_can_access_chapter_rules():
    free_book = Book(id="b1", publisher_id="p1", title="F", description="", price_cents=0, status="published")
    paid_book = Book(id="b2", publisher_id="p1", title="P", description="", price_cents=499, status="published")
    ch1 = Chapter(id="c1", book_id="b2", position=1, title="1", content="x", word_count=1, group_index=1)
    ch2 = Chapter(id="c2", book_id="b2", position=2, title="2", content="y", word_count=1, group_index=2)

    assert can_access_chapter(book=free_book, chapter=ch2, user_id=None, purchased=False)
    assert can_access_chapter(book=paid_book, chapter=ch1, user_id=None, purchased=False)
    assert not can_access_chapter(book=paid_book, chapter=ch2, user_id=None, purchased=False)
    assert can_access_chapter(book=paid_book, chapter=ch2, user_id="p1", purchased=False)
    assert can_access_chapter(book=paid_book, chapter=ch2, user_id="r1", purchased=True)
    assert not can_access_chapter(book=paid_book, chapter=ch2, user_id="r1", purchased=False)
