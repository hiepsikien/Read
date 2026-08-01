from app.cast_recommend import choose_diversified_persona, parse_recommendation_payload
from app.voice_cast import explain_cast_inference


def test_explain_cast_inference_mentions_cues():
    attrs, rationale = explain_cast_inference(
        "Mạc Đăng Dung",
        "Vua / minh quân, tướng lĩnh cứng rắn (1483–1541).",
    )
    assert attrs["gender"] == "male"
    assert attrs["age_band"] in {"adult", "elder"}
    assert "nam" in rationale.lower() or "Nam" in rationale
    assert "Persona" in rationale or "persona" in rationale.lower() or "nhóm" in rationale


def test_diversify_demotes_charon_when_alternatives_free():
    persona = choose_diversified_persona(
        gender="male",
        suggested="Charon",
        used=set(),
        max_voices=12,
        name="Một quan văn bình thường",
        age_band="adult",
        presence="neutral",
    )
    assert persona != "Charon"
    assert persona in {
        "Puck",
        "Achird",
        "Algenib",
        "Enceladus",
        "Fenrir",
        "Algieba",
        "Iapetus",
        "Schedar",
        "Umbriel",
        "Alnilam",
        # Orus also biased — should avoid unless allowed
    }
    assert persona != "Orus"


def test_diversify_allows_charon_for_forceful_elder():
    persona = choose_diversified_persona(
        gender="male",
        suggested="Charon",
        used=set(),
        max_voices=12,
        name="Mạc Đăng Dung",
        age_band="elder",
        presence="forceful",
    )
    assert persona == "Charon"


def test_diversify_skips_taken():
    used = {
        "vi-VN-Chirp3-HD-Achird",
        "vi-VN-Chirp3-HD-Algenib",
        "vi-VN-Chirp3-HD-Enceladus",
    }
    persona = choose_diversified_persona(
        gender="male",
        suggested="Achird",
        used=used,
        max_voices=12,
        name="Nhân vật B",
        age_band="adult",
        presence="neutral",
    )
    assert persona not in {"Achird", "Algenib", "Enceladus"}


def test_parse_recommendation_payload_ok():
    raw = """
    {
      "gender": "male",
      "age_band": "elder",
      "presence": "forceful",
      "chirp_persona": "Charon",
      "rationale": "Vua / tướng lĩnh, giọng trầm."
    }
    """
    parsed = parse_recommendation_payload(raw)
    assert parsed is not None
    assert parsed["gender"] == "male"
    assert parsed["age_band"] == "elder"
    assert parsed["presence"] == "forceful"
    assert parsed["chirp_persona"] == "Charon"
    assert "tướng" in parsed["rationale"]


def test_parse_recommendation_drops_wrong_gender_persona():
    raw = '{"gender":"male","age_band":"adult","presence":"neutral","chirp_persona":"Aoede"}'
    parsed = parse_recommendation_payload(raw)
    assert parsed is not None
    assert parsed["chirp_persona"] == ""


def test_parse_recommendation_rejects_invalid():
    assert parse_recommendation_payload('{"gender":"other","age_band":"adult","presence":"neutral"}') is None
    assert parse_recommendation_payload("not json") is None
