from types import SimpleNamespace

from app.glossary import aliases_to_storage
from app.speaking_cast import (
    collect_speaking_appearances,
    extract_speakers_from_content,
    match_speaker_to_glossary,
    speaking_cast_plan,
)


SAMPLE = """
Biển đêm im ắng.

VASCO *(khẽ)* Chúng ta đi tiếp.

AFONSO Đừng chậm bước.

Một người lạ xuất hiện.

UNKNOWN *(to)* Ai đó?

VASCO Tiếp tục.
"""


def test_extract_speakers_from_screenplay():
    speakers = extract_speakers_from_content(SAMPLE)
    assert speakers == ["Vasco", "Afonso", "Unknown"]


def test_collect_speaking_appearances_counts_and_order():
    chapters = [
        SimpleNamespace(id="c1", title="Ch.1", position=1, content=SAMPLE),
        SimpleNamespace(
            id="c2",
            title="Ch.2",
            position=2,
            content="VASCO *(nhẹ)* Quay lại.\n\n",
        ),
    ]
    appearances = collect_speaking_appearances(chapters)
    by_key = {item.key: item for item in appearances}
    assert list(by_key) == ["vasco", "afonso", "unknown"]
    assert by_key["vasco"].line_count == 3
    assert by_key["vasco"].first_chapter_title == "Ch.1"
    assert by_key["unknown"].line_count == 1


def test_match_speaker_to_glossary_alias_and_partial():
    entries = [
        SimpleNamespace(
            id="1",
            name="Vasco da Gama",
            aliases=aliases_to_storage(["Vasco"]),
        ),
        SimpleNamespace(
            id="2",
            name="Afonso de Albuquerque",
            aliases="[]",
        ),
    ]
    assert match_speaker_to_glossary(entries, "VASCO").id == "1"
    assert match_speaker_to_glossary(entries, "AFONSO").id == "2"
    assert match_speaker_to_glossary(entries, "STRANGER") is None


def test_speaking_cast_plan_separates_unmatched_and_glossary_only():
    chapters = [SimpleNamespace(id="c1", title="One", position=1, content=SAMPLE)]
    glossary = [
        SimpleNamespace(
            id="g1",
            name="Vasco da Gama",
            aliases=aliases_to_storage(["Vasco"]),
        ),
        SimpleNamespace(
            id="g2",
            name="Afonso de Albuquerque",
            aliases="[]",
        ),
        SimpleNamespace(
            id="g3",
            name="Công chúa An Vi",
            aliases="[]",
        ),
    ]
    plan = speaking_cast_plan(chapters, glossary)
    assert plan["speaking_count"] == 3
    assert plan["unmatched_count"] == 1
    assert plan["glossary_count"] == 3
    speaking_names = [item["glossary_entry"].name for item in plan["speaking"]]
    assert speaking_names == ["Vasco da Gama", "Afonso de Albuquerque"]
    assert plan["unmatched"][0]["speaker_cue"] == "Unknown"
    assert [entry.name for entry in plan["glossary_only"]] == ["Công chúa An Vi"]
