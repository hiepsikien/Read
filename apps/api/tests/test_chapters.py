from app.access import can_access_chapter
from app.chapters import (
    MAX_WORDS,
    SPLIT_PROFILES,
    TARGET_WORDS,
    count_words,
    normalize_document_text,
    plain_text,
    resolve_split_profile,
    split_into_chapters,
)
from app.models import Book, Chapter


def para(words: int, seed: str = "word") -> str:
    return " ".join(f"{seed}{i}" for i in range(words))


# Sized off the packing constants so the tests keep their intent if we retune them.
SECTION_WORDS = TARGET_WORDS // 4
OVERSIZED_PARA_WORDS = MAX_WORDS // 2


def test_keeps_existing_chapters_and_does_not_tear_section():
    text = "\n".join(
        [
            "Chapter 1 — Arrival",
            "",
            "Section 1 — Harbor",
            "",
            para(SECTION_WORDS, "harbor"),
            "",
            "Section 2 — Lanterns",
            "",
            para(SECTION_WORDS, "lantern"),
            "",
            "Section 3 — Fog",
            "",
            para(SECTION_WORDS, "fog"),
            "",
            "Section 4 — Tide",
            "",
            para(SECTION_WORDS, "tide"),
            "",
            "Section 5 — Letters",
            "",
            para(SECTION_WORDS, "letter"),
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
    unique_a = "ALPHA_UNIQUE_MARKER " + para(OVERSIZED_PARA_WORDS, "alpha") + "."
    unique_b = "BETA_UNIQUE_MARKER " + para(OVERSIZED_PARA_WORDS, "beta") + "."
    unique_c = "GAMMA_UNIQUE_MARKER " + para(OVERSIZED_PARA_WORDS, "gamma") + "."
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


def test_reflows_pdf_style_word_per_line_text():
    text = "\n".join(
        [
            "LỜI MỞ ĐẦU",
            "",
            "Khi ánh hoàng hôn của thời Trung cổ dần lịm tắt, một bình minh",
            "",
            "mới",
            "",
            "của",
            "",
            "trí",
            "",
            "tuệ",
            "",
            "đã bừng tỉnh.",
            "",
            "Câu tiếp theo mở ra một đoạn khác.",
        ]
    )

    normalized = normalize_document_text(text)

    assert "một bình minh mới của trí tuệ đã bừng tỉnh." in normalized
    assert normalized.startswith("LỜI MỞ ĐẦU\n\n")
    # Two prose paragraphs plus the heading, and no stray single newlines.
    assert len(normalized.split("\n\n")) == 3
    assert "\n" not in normalized.replace("\n\n", "")


def test_reflow_keeps_docx_style_paragraphs_separate():
    text = "\n\n".join(
        [
            "First paragraph ends here.",
            "Second paragraph stands alone.",
            "Third one too.",
        ]
    )

    assert normalize_document_text(text, preserve_paragraphs=True).split("\n\n") == [
        "First paragraph ends here.",
        "Second paragraph stands alone.",
        "Third one too.",
    ]


def test_keeps_long_uppercase_scene_heading_on_its_own_line():
    heading = "MẬT PHÒNG ĐIỆN KÍNH THIÊN - THĂNG LONG - ĐÊM 1510"
    prose = "Ngọn đèn dầu lay động trong căn phòng kín."

    normalized = normalize_document_text(
        f"{heading}\n\n{prose}", preserve_paragraphs=True
    )

    assert normalized == f"{heading}\n\n{prose}"


def test_docx_paragraph_without_terminal_punctuation_stays_separate():
    text = "Một dòng chủ ý không có dấu cuối\n\nĐoạn văn tiếp theo."

    normalized = normalize_document_text(text, preserve_paragraphs=True)

    assert normalized == text


def test_markdown_does_not_affect_heading_detection_or_word_count():
    text = (
        "**CHƯƠNG 1 — KHỞI ĐẦU**\n\n"
        "Một đoạn có **chữ đậm** và *chữ nghiêng*."
    )

    units = split_into_chapters(text)

    assert len(units) == 1
    assert units[0].title == "Chapter 1 — KHỞI ĐẦU"
    assert "**chữ đậm**" in units[0].content
    assert "*chữ nghiêng*" in units[0].content
    assert count_words("Một **hai** *ba*") == 3
    assert plain_text(r"Một \* ký tự") == "Một * ký tự"


def test_segments_target_longer_reading_units():
    text = "\n\n".join(para(600, f"seg{i}") + "." for i in range(10))

    units = split_into_chapters(text)

    assert units
    # Roughly TARGET_WORDS per unit rather than the old ~850.
    assert all(count_words(u.content) <= MAX_WORDS for u in units)
    assert max(count_words(u.content) for u in units) > 1200


def test_split_length_presets_change_part_count():
    text = "\n\n".join(para(500, f"blk{i}") + "." for i in range(10))

    short = split_into_chapters(text, length="short")
    standard = split_into_chapters(text, length="standard")
    long = split_into_chapters(text, length="long")

    assert len(short) > len(standard) > len(long)
    assert all(
        count_words(unit.content) <= SPLIT_PROFILES["short"].max_words for unit in short
    )
    assert all(
        count_words(unit.content) <= SPLIT_PROFILES["long"].max_words for unit in long
    )
    assert resolve_split_profile("standard").target_words == TARGET_WORDS


def test_unknown_split_length_is_rejected():
    try:
        resolve_split_profile("huge")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "huge" in str(exc)


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
