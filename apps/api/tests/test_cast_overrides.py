from app.cast_overrides import (
    apply_overrides_to_cast_maps,
    duplicate_voice_warnings,
    is_canonical_lookup_key,
    overrides_raw_needs_rewrite,
    parse_cast_overrides,
    serialize_cast_overrides,
)
from app.glossary import normalize_lookup


def test_normalize_lookup_folds_vietnamese_d():
    assert normalize_lookup("Mạc Đăng Dung") == "mac dang dung"
    assert normalize_lookup("mac đang dung") == "mac dang dung"
    assert is_canonical_lookup_key("mac dang dung")
    assert not is_canonical_lookup_key("mac đang dung")


def test_parse_cast_overrides_merges_dirty_keys_preferring_locked():
    raw = """
    {
      "mac đang dung": {"tts_voice": "vi-VN-Chirp3-HD-Charon", "cast_locked": false},
      "mac dang dung": {"tts_voice": "vi-VN-Chirp3-HD-Algieba", "cast_locked": true}
    }
    """
    cleaned = parse_cast_overrides(raw)
    assert list(cleaned.keys()) == ["mac dang dung"]
    assert cleaned["mac dang dung"]["tts_voice"].endswith("Algieba")
    assert cleaned["mac dang dung"]["cast_locked"] is True


def test_parse_cast_overrides_dirty_after_canonical_keeps_locked():
    raw = """
    {
      "mac dang dung": {"tts_voice": "vi-VN-Chirp3-HD-Algieba", "cast_locked": true},
      "mac đang dung": {"tts_voice": "vi-VN-Chirp3-HD-Charon", "cast_locked": false}
    }
    """
    cleaned = parse_cast_overrides(raw)
    assert cleaned["mac dang dung"]["tts_voice"].endswith("Algieba")


def test_serialize_cast_overrides_only_writes_canonical_keys():
    payload = serialize_cast_overrides(
        {
            "mac đang dung": {"tts_voice": "vi-VN-Chirp3-HD-Charon", "cast_locked": False},
            "mac dang dung": {"tts_voice": "vi-VN-Chirp3-HD-Algieba", "cast_locked": True},
        }
    )
    assert "đ" not in payload
    assert "mac dang dung" in payload
    assert overrides_raw_needs_rewrite(
        '{"mac đang dung": {"tts_voice": "x", "cast_locked": false}}'
    )
    assert not overrides_raw_needs_rewrite(payload)


def test_apply_overrides_locked_glossary_beats_dirty_override():
    class Row:
        def __init__(self, name, voice, locked):
            self.name = name
            self.tts_voice = voice
            self.cast_locked = locked
            self.presence = "neutral"

    voices = {"mac dang dung": "vi-VN-Chirp3-HD-Orus"}
    presence = {"mac dang dung": "neutral"}
    overrides = parse_cast_overrides(
        '{"mac đang dung": {"tts_voice": "vi-VN-Chirp3-HD-Charon", "cast_locked": false}}'
    )
    merged, _ = apply_overrides_to_cast_maps(
        voices,
        presence,
        entries=[Row("Mạc Đăng Dung", "vi-VN-Chirp3-HD-Algieba", True)],
        overrides=overrides,
    )
    assert merged["mac dang dung"].endswith("Algieba")


def test_duplicate_voice_warnings():
    warnings = duplicate_voice_warnings(
        {"a": "Mạc Đăng Dung", "b": "Mạc Kính Điển", "c": "Other"},
        {
            "a": "vi-VN-Chirp3-HD-Charon",
            "b": "vi-VN-Chirp3-HD-Charon",
            "c": "vi-VN-Chirp3-HD-Puck",
        },
    )
    assert len(warnings) == 1
    assert "Charon" in warnings[0]
    assert "Mạc Đăng Dung" in warnings[0]
    assert "Mạc Kính Điển" in warnings[0]
