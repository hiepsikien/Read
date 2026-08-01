from types import SimpleNamespace

from app import voice_cast
from app.glossary import aliases_to_storage


def test_infer_gender_from_summary_cues():
    assert voice_cast.infer_gender("Lê Thánh Tông", "Minh quân nhà Lê Sơ.") == "male"
    assert voice_cast.infer_gender("Vasco da Gama", "Nhà thám hiểm Bồ Đào Nha.") == "male"
    assert voice_cast.infer_gender("Afonso", "Đô đốc Bồ Đào Nha.") == "male"
    assert (
        voice_cast.infer_gender("Công chúa An Vi", "Công chúa nhà Lê, thiếu nữ tài sắc.")
        == "female"
    )
    assert voice_cast.infer_gender("Nguyễn Thị Loan", "Phu nhân trong triều.") == "female"


def test_infer_age_band_from_cues_and_years():
    assert voice_cast.infer_age_band("An", "Thiếu nữ trong cung.") == "youth"
    assert voice_cast.infer_age_band("Lão Tướng", "Lão tướng cuối đời.") == "elder"
    assert voice_cast.infer_age_band("Vasco", "(k. 1469 – 1524) Nhà thám hiểm.") == "adult"
    assert voice_cast.infer_age_band("Afonso", "(1453 – 1515) Đô đốc.") == "elder"
    assert voice_cast.infer_age_band("Trẻ", "(1495 – 1560) Công tử.") == "youth"
    assert (
        voice_cast.infer_presence(
            "Afonso de Albuquerque",
            'Đô đốc hải quân. Ông được mệnh danh là "Sư tử biển quốc vương".',
        )
        == "forceful"
    )


def test_cast_profiles_keep_gender_and_reuse_across_episodes():
    entries = [
        SimpleNamespace(
            name="Vasco da Gama",
            aliases=aliases_to_storage(["Vasco"]),
            summary="Nhà thám hiểm Bồ Đào Nha.",
            gender="",
            age_band="",
            tts_voice="",
            episode_key="S1E1",
        ),
        SimpleNamespace(
            name="Vasco da Gama",
            aliases="[]",
            summary="Nhà thám hiểm Bồ Đào Nha.",
            gender="",
            age_band="",
            tts_voice="",
            episode_key="S1E2",
        ),
        SimpleNamespace(
            name="Công chúa An Vi",
            aliases="[]",
            summary="Công chúa nhà Lê, thiếu nữ tài sắc.",
            gender="",
            age_band="",
            tts_voice="",
            episode_key="S1E1",
        ),
        SimpleNamespace(
            name="Afonso de Albuquerque",
            aliases="[]",
            summary="Đô đốc Bồ Đào Nha.",
            gender="",
            age_band="",
            tts_voice="",
            episode_key="S1E1",
        ),
    ]

    profiles = voice_cast.cast_profiles_for_entries(
        entries,
        engine="chirp3",
        narrator_voice="vi-VN-Chirp3-HD-Charon",
    )
    voice_cast.apply_cast_to_entries(entries, profiles)

    vasco = profiles["vasco da gama"]
    princess = profiles["cong chua an vi"]
    afonso = profiles["afonso de albuquerque"]

    assert vasco.gender == "male"
    assert princess.gender == "female"
    assert afonso.gender == "male"
    assert vasco.voice.startswith("vi-VN-Chirp3-HD-")
    assert princess.voice.startswith("vi-VN-Chirp3-HD-")
    assert vasco.voice != "vi-VN-Chirp3-HD-Charon"
    # Same person across episodes shares one voice.
    assert entries[0].tts_voice == entries[1].tts_voice == vasco.voice
    # Male characters stay on male personas; female stays female.
    assert vasco.voice.rsplit("-", 1)[-1] in voice_cast.CAST_PERSONAS["male"]
    assert afonso.voice.rsplit("-", 1)[-1] in voice_cast.CAST_PERSONAS["male"]
    assert princess.voice.rsplit("-", 1)[-1] in voice_cast.CAST_PERSONAS["female"]
    assert vasco.voice != afonso.voice
    # Alias resolves to the same cast.
    assert profiles["vasco"].voice == vasco.voice


def test_male_narrator_does_not_force_female_on_male_speakers():
    from app.tts import SpeakerVoiceCast

    cast = SpeakerVoiceCast(
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        glossary_voices={"vasco da gama": "vi-VN-Chirp3-HD-Orus"},
        narrator_gender="male",
    )
    assert cast.voice_for("VASCO DA GAMA") == "vi-VN-Chirp3-HD-Orus"
    unknown_male = cast.voice_for("AFONSO DE ALBUQUERQUE")
    assert unknown_male.rsplit("-", 1)[-1] in voice_cast.CAST_PERSONAS["male"]
    assert unknown_male != "vi-VN-Chirp3-HD-Aoede"
