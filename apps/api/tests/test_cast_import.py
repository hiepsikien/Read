"""Unit tests for cross-episode cast import matching."""

from types import SimpleNamespace

from app.cast_import import build_source_cast_lookup, import_cast_from_source
from app.glossary import aliases_to_storage


def _entry(**kwargs):
    defaults = {
        "name": "Vasco",
        "aliases": "[]",
        "summary": "",
        "group_label": "Nhân vật",
        "gender": "male",
        "age_band": "adult",
        "presence": "neutral",
        "tts_voice": "vi-VN-Chirp3-HD-Puck",
        "cast_locked": False,
        "updated_at": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_build_lookup_indexes_aliases_and_prefers_locked():
    entries = [
        _entry(
            name="Vasco da Gama",
            aliases=aliases_to_storage(["Vasco"]),
            tts_voice="vi-VN-Chirp3-HD-Puck",
            cast_locked=True,
        )
    ]
    overrides = {
        "vasco": {
            "gender": "male",
            "age_band": "adult",
            "presence": "neutral",
            "tts_voice": "vi-VN-Chirp3-HD-Charon",
            "cast_locked": False,
        }
    }
    lookup = build_source_cast_lookup(entries, overrides)
    assert lookup["vasco da gama"]["tts_voice"].endswith("Puck")
    assert lookup["vasco"]["tts_voice"].endswith("Puck")
    assert lookup["vasco"]["cast_locked"] is True


def test_import_matches_by_alias_and_skips_locked_target():
    source = [
        _entry(
            name="Vasco da Gama",
            aliases=aliases_to_storage(["Vasco"]),
            tts_voice="vi-VN-Chirp3-HD-Algieba",
            gender="male",
            age_band="adult",
            presence="forceful",
            cast_locked=True,
        ),
        _entry(
            name="Afonso",
            tts_voice="vi-VN-Chirp3-HD-Charon",
            cast_locked=True,
        ),
    ]
    target = [
        _entry(
            name="Vasco",
            aliases="[]",
            tts_voice="vi-VN-Chirp3-HD-Puck",
            cast_locked=False,
        ),
        _entry(
            name="Afonso",
            tts_voice="vi-VN-Chirp3-HD-Orus",
            cast_locked=True,
        ),
        _entry(
            name="New Character",
            tts_voice="vi-VN-Chirp3-HD-Zephyr",
            gender="female",
            cast_locked=False,
        ),
    ]
    overrides: dict = {}
    result = import_cast_from_source(
        target_entries=target,
        target_overrides=overrides,
        source_entries=source,
        source_overrides_raw="{}",
        lock_imported=True,
    )
    assert result["matched"] == 2
    assert result["unmatched"] == 1
    assert result["skipped_locked"] == 1
    assert result["updated"] == 1
    assert result["carried"] == 0
    assert target[0].tts_voice.endswith("Algieba")
    assert target[0].cast_locked is True
    assert target[0].presence == "forceful"
    assert target[1].tts_voice.endswith("Orus")  # locked, unchanged
    assert target[2].tts_voice.endswith("Zephyr")  # unmatched, unchanged
    assert overrides["vasco"]["tts_voice"].endswith("Algieba")


def test_import_carries_forward_missing_source_characters():
    source = [
        _entry(
            name="Vasco da Gama",
            aliases=aliases_to_storage(["Vasco"]),
            summary="Explorer",
            tts_voice="vi-VN-Chirp3-HD-Algieba",
            cast_locked=True,
        ),
        _entry(
            name="Silent Elder",
            summary="Does not speak in ep2 yet",
            tts_voice="vi-VN-Chirp3-HD-Charon",
            age_band="elder",
            cast_locked=True,
        ),
    ]
    target = [
        _entry(
            name="Vasco",
            tts_voice="vi-VN-Chirp3-HD-Puck",
            cast_locked=False,
        ),
    ]
    overrides: dict = {}
    result = import_cast_from_source(
        target_entries=target,
        target_overrides=overrides,
        source_entries=source,
        source_overrides_raw="{}",
        lock_imported=True,
        carry_forward=True,
        episode_key="S1E2",
        episode_title="Episode 2",
    )
    assert result["matched"] == 1
    assert result["updated"] == 1
    assert result["carried"] == 1
    assert len(result["carry_forward"]) == 1
    carried = result["carry_forward"][0]
    assert carried["name"] == "Silent Elder"
    assert carried["tts_voice"].endswith("Charon")
    assert carried["age_band"] == "elder"
    assert carried["episode_key"] == "S1E2"
    assert carried["cast_locked"] is True
    assert overrides["silent elder"]["tts_voice"].endswith("Charon")
