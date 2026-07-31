from app.segment_titles import (
    fallback_distinctive_name,
    format_segment_title,
    normalize_suggest_language,
    normalize_title_components,
    part_label,
)


def test_normalize_title_components_preserves_order_and_defaults():
    assert normalize_title_components(None) is None
    assert normalize_title_components([]) == ["name", "part"]
    assert normalize_title_components(["part", "book", "name", "book"]) == [
        "part",
        "book",
        "name",
    ]
    assert normalize_title_components(["nope", "part"]) == ["part"]


def test_format_segment_title_skips_empty_book():
    title = format_segment_title(
        components=["book", "name", "part"],
        book_title="  ",
        distinctive_name="Harbor Lights",
        part_index=2,
        language="en",
    )
    assert title == "Harbor Lights · Part 2"


def test_format_segment_title_order_and_vietnamese_part():
    title = format_segment_title(
        components=["part", "name", "book"],
        book_title="Sea Route",
        distinctive_name="Bão nổi",
        part_index=1,
        language="vi",
    )
    assert title == "Phần 1 · Bão nổi · Sea Route"
    assert part_label(3, language="bilingual") == "Phần 3"
    assert part_label(3, language="en") == "Part 3"


def test_fallback_distinctive_name_prefers_section():
    assert (
        fallback_distinctive_name("Chapter 1 — Opening", ["Harbor", None]) == "Harbor"
    )
    assert fallback_distinctive_name("Chapter 2 — Dawn", []) == "Dawn"


def test_normalize_suggest_language():
    assert normalize_suggest_language("VI") == "vi"
    assert normalize_suggest_language("both") == "bilingual"
    assert normalize_suggest_language(None) == "en"
