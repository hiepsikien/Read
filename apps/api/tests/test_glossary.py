from app.glossary import (
    entry_match_score,
    find_glossary_matches,
    find_names_in_text,
    infer_episode_key,
    parse_glossary_paragraphs,
)


SAMPLE = [
    "NHÂN VẬT",
    "S1E1: GIÔNG BÃO KINH THÀNH",
    "NHÂN VẬT LỊCH SỬ VIỆT NAM",
    "Lê Thánh Tông (1442 – 1497): Minh quân nhà Lê Sơ.",
    "Mạc Đăng Dung (1483 – 1541): Người làng Cổ Trai, thăng tiến thần tốc.",
    "NHÂN VẬT LỊCH SỬ QUỐC TẾ",
    "Vasco da Gama (k. 1460/1469 – 1524): Nhà thám hiểm Bồ Đào Nha.",
    "Hugo Grotius (Huig de Groot - 1583 – 1645): Luật gia Hà Lan.",
    "Tokugawa Ieyasu (Đức Xuyên Gia Khang - 1543 – 1616): Chúa Nhật Bản.",
    "S1E2: ĐÈO NGANG MỞ LỐI",
    "NHÂN VẬT LỊCH SỬ VIỆT NAM",
    "Nguyễn Hoàng (1525 – 1613): Chúa Tiên vào Thuận Hóa.",
]


def test_parse_glossary_paragraphs_groups_by_episode():
    entries = parse_glossary_paragraphs(SAMPLE)
    assert len(entries) == 6
    s1e1 = [e for e in entries if e.episode_key == "S1E1"]
    s1e2 = [e for e in entries if e.episode_key == "S1E2"]
    assert len(s1e1) == 5
    assert len(s1e2) == 1
    vasco = next(e for e in entries if e.name == "Vasco da Gama")
    assert "Bồ Đào Nha" in vasco.summary
    assert vasco.group_label.upper().startswith("NHÂN VẬT LỊCH SỬ QUỐC TẾ")


def test_aliases_extracted_from_meta_and_alt_names():
    entries = parse_glossary_paragraphs(SAMPLE)
    hugo = next(e for e in entries if e.name == "Hugo Grotius")
    assert any("Huig de Groot" in alias for alias in hugo.aliases)
    tokugawa = next(e for e in entries if e.name == "Tokugawa Ieyasu")
    assert any("Đức Xuyên Gia Khang" in alias or "Duc Xuyen" in alias for alias in tokugawa.aliases)


def test_match_prefers_exact_and_episode_boost():
    entries = parse_glossary_paragraphs(SAMPLE)
    matches = find_glossary_matches(entries, "Vasco da Gama", episode_key="S1E1")
    assert matches
    assert matches[0][0].name == "Vasco da Gama"
    assert matches[0][1] >= 100


def test_match_alias():
    entries = parse_glossary_paragraphs(SAMPLE)
    assert entry_match_score("Huig de Groot", "Hugo Grotius", ["Huig de Groot"]) >= 80
    matches = find_glossary_matches(entries, "Huig de Groot")
    assert matches[0][0].name == "Hugo Grotius"


def test_find_footnote_marker_attached_to_name():
    class Entry:
        def __init__(self):
            self.name = "Seneca"
            self.aliases = ["[4]"]
            self.episode_key = ""

    found = find_names_in_text(
        [Entry()],
        "Nature has given all peoples a right of access. Seneca[4] thinks this is Nature's greatest service.",
    )
    assert [e.name for e in found] == ["Seneca"]
    assert find_names_in_text([Entry()], "See note [40] only.") == []


def test_find_names_in_paragraph():
    entries = parse_glossary_paragraphs(SAMPLE)
    text = "Bờ biển Calicut. VASCO DA GAMA đã đi vào lịch sử cùng Mạc Đăng Dung."
    found = find_names_in_text(entries, text, episode_key="S1E1")
    names = {entry.name for entry in found}
    assert "Vasco da Gama" in names
    assert "Mạc Đăng Dung" in names


def test_paragraph_scan_ignores_lowercase_common_nouns():
    entries = parse_glossary_paragraphs(
        [
            "S1E1: TEST",
            "Văn Phong (? – 1600): Một vị tướng.",
        ]
    )
    assert find_names_in_text(entries, "tôi chọn cách kết hợp văn phong hiện đại") == []
    assert [e.name for e in find_names_in_text(entries, "Tướng Văn Phong bước vào.")] == [
        "Văn Phong"
    ]


def test_paragraph_scan_matches_all_caps_screenplay_names():
    entries = parse_glossary_paragraphs(SAMPLE)
    found = find_names_in_text(entries, "Bờ biển Calicut. VASCO DA GAMA đã tới.")
    assert [entry.name for entry in found] == ["Vasco da Gama"]


def test_paragraph_scan_requires_whole_words():
    entries = parse_glossary_paragraphs(SAMPLE)
    assert find_names_in_text(entries, "Trần Cảnh và Trần Cảohoa không có thật") == []


def test_infer_episode_key():
    assert infer_episode_key("S1E1C1 — Opening", "Đại Lộ Đại Dương") == "S1E1"
    assert infer_episode_key("Chapter 1", "S1E1C1 - Đại Lộ.docx") == "S1E1"
    assert infer_episode_key("Chapter 1", "Book") == ""
