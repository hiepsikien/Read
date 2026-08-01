from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from nanoid import generate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import tts
from app.auth import hash_password
from app.categories import ensure_categories
from app.config import Settings
from app.db import Base, get_db
from app.main import app
from app.models import Book, Chapter, User
from app.routers import books


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session = sessionmaker(bind=engine)()
    Base.metadata.create_all(bind=engine)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded(db_session):
    categories = ensure_categories(db_session)
    now = datetime.now(timezone.utc)
    publisher = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="tts-author@example.com",
        name="TTS Author",
        role="publisher",
        password_hash=hash_password("password123"),
        created_at=now,
    )
    db_session.add(publisher)
    db_session.commit()
    return {
        "publisher": publisher,
        "fiction": next(category for category in categories if category.slug == "fiction"),
    }


def test_chapter_audio_segments_normalize_text_and_respect_byte_limit():
    content = (
        "1. **Mở đầu** [1] (2)\n"
        "Đọc thêm tại https://example.com.\n\n"
        + ("Một câu tiếng Việt khá dài. " * 300)
    )

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert segments
    assert all(segment.is_ssml for segment in segments)
    assert all(segment.kind == "narration" for segment in segments)
    assert all(segment.voice == "vi-VN-Neural2-D" for segment in segments)
    assert "Mở đầu Đọc thêm tại." in segments[0].text
    assert 'rate="98%"' in segments[0].text
    assert 'pitch="-1st"' in segments[0].text
    assert all(len(segment.text.encode("utf-8")) <= tts.MAX_TTS_INPUT_BYTES for segment in segments)
    assert all(segment.cache_key for segment in segments)


def test_screenplay_dialogue_uses_contrast_without_spoken_cues():
    content = (
        "COLUMBUS *(Giọng khàn đặc)* "
        "Nhân danh Chúa Kitô cứu thế!\n\n"
        "NGƯỜI THƯ KÝ (Hộ tống) *(Thì thầm, mắt đầy kinh ngạc)* "
        "Thưa thuyền trưởng, đây là Calicut.\n\n"
        "AFONSO DE ALBUQUERQUE (58 tuổi) đứng trên mũi soái hạm."
    )

    segments = tts.chapter_audio_segments(
        content,
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        glossary_voices={
            "columbus": "vi-VN-Chirp3-HD-Orus",
            "nguoi thu ky": "vi-VN-Chirp3-HD-Aoede",
        },
        narrator_gender="male",
    )

    assert len(segments) == 3
    assert segments[0].is_ssml is True
    assert segments[0].kind == "dialogue"
    assert segments[0].speaker == "Columbus"
    assert segments[0].voice == "vi-VN-Chirp3-HD-Orus"
    assert '<break time="200ms"/>' in segments[0].text
    assert "Columbus." not in segments[0].text
    assert "Giọng khàn đặc." not in segments[0].text
    assert "Nhân danh Chúa Kitô cứu thế!" in segments[0].text
    assert 'pitch="-1st"' in segments[0].text
    assert 'rate="96%"' in segments[0].text

    assert segments[1].is_ssml is True
    assert segments[1].kind == "dialogue"
    assert segments[1].speaker == "Người Thư Ký"
    assert segments[1].voice == "vi-VN-Chirp3-HD-Aoede"
    assert "Người Thư Ký." not in segments[1].text
    assert "Hộ tống." not in segments[1].text
    assert "Thì thầm, mắt đầy kinh ngạc." not in segments[1].text
    assert "Thưa thuyền trưởng, đây là Calicut." in segments[1].text
    assert 'rate="90%"' in segments[1].text
    assert 'volume="-4dB"' in segments[1].text

    # Ordinary prose with a parenthetical age must stay narrator-voiced.
    assert segments[2].kind == "narration"
    assert segments[2].voice == "vi-VN-Chirp3-HD-Charon"
    assert segments[2].is_ssml is True
    assert "Afonso De Albuquerque (58 tuổi) đứng trên mũi soái hạm." in segments[2].text
    assert 'rate="98%"' in segments[2].text


def test_shouted_dialogue_raises_rate_and_pitch():
    content = "COLUMBUS *(Hét lớn, vang dội)* Lui binh!"

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert len(segments) == 1
    assert segments[0].kind == "dialogue"
    assert "Lui binh!" in segments[0].text
    assert 'rate="106%"' in segments[0].text
    assert 'pitch="+3st"' in segments[0].text
    assert 'volume="+2dB"' in segments[0].text


def test_leading_stage_direction_shapes_prosody_without_reading_cue():
    content = "*(Ông nhìn ra đại dương bao la phía sau)* Hãy nhìn cho kỹ."

    segments = tts.chapter_audio_segments(
        content,
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        narrator_gender="male",
    )

    assert len(segments) == 1
    assert segments[0].is_ssml is True
    assert segments[0].kind == "dialogue"
    assert segments[0].voice.rsplit("-", 1)[-1] in {"Puck", "Orus", "Charon"}
    assert "Ông nhìn ra đại dương bao la phía sau." not in segments[0].text
    assert '<break time="200ms"/>' in segments[0].text
    assert "Hãy nhìn cho kỹ." in segments[0].text


def test_screenplay_dialogue_without_direction_casts_distinct_voices():
    content = (
        "LÊ THÁNH TÔNG Ta giao cho con một bờ cõi thái bình.\n\n"
        "VASCO DA GAMA Chúng ta đã chạm tay vào nguồn gốc của thế giới.\n\n"
        "NGƯỜI THƯ KÝ Thưa ông, đó là tuyên chiến.\n\n"
        "NỘI THỊ Bẩm Thái sư, xin dùng canh."
    )

    segments = tts.chapter_audio_segments(
        content,
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        glossary_voices={
            "le thanh tong": "vi-VN-Chirp3-HD-Orus",
            "vasco da gama": "vi-VN-Chirp3-HD-Puck",
            "nguoi thu ky": "vi-VN-Chirp3-HD-Aoede",
            "noi thi": "vi-VN-Chirp3-HD-Kore",
        },
        narrator_gender="male",
    )

    assert len(segments) == 4
    assert all(segment.is_ssml for segment in segments)
    assert all(segment.kind == "dialogue" for segment in segments)
    assert [segment.speaker for segment in segments] == [
        "Lê Thánh Tông",
        "Vasco Da Gama",
        "Người Thư Ký",
        "Nội Thị",
    ]
    assert [segment.voice for segment in segments] == [
        "vi-VN-Chirp3-HD-Orus",
        "vi-VN-Chirp3-HD-Puck",
        "vi-VN-Chirp3-HD-Aoede",
        "vi-VN-Chirp3-HD-Kore",
    ]
    assert all("Lê Thánh Tông." not in segment.text for segment in segments)
    assert "Ta giao cho con một bờ cõi thái bình." in segments[0].text
    assert all('<break time="200ms"/>' in segment.text for segment in segments)
    assert all('rate="100%"' in segment.text for segment in segments)
    assert all('pitch="+0st"' in segment.text for segment in segments)


def test_dash_led_paragraphs_continue_previous_speaker():
    content = (
        "NGUYỄN BỈNH KHIÊM Không. Tư duy cũ của nhà Lê sơ là trọng nông.\n\n"
        "– *Một là, về đất đai*, phải định lại phép quân điền.\n\n"
        "— Hai là, quan trọng hơn, phải cởi trói cho thương nghiệp.\n\n"
        "AFONSO DE ALBUQUERQUE (58 tuổi) đứng trên mũi soái hạm."
    )

    segments = tts.chapter_audio_segments(
        content,
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        glossary_voices={"nguyen binh khiem": "vi-VN-Chirp3-HD-Orus"},
        narrator_gender="male",
    )

    assert len(segments) == 4
    assert [segment.kind for segment in segments] == [
        "dialogue",
        "dialogue",
        "dialogue",
        "narration",
    ]
    assert [segment.speaker for segment in segments[:3]] == [
        "Nguyễn Bỉnh Khiêm",
        "Nguyễn Bỉnh Khiêm",
        "Nguyễn Bỉnh Khiêm",
    ]
    assert [segment.voice for segment in segments[:3]] == [
        "vi-VN-Chirp3-HD-Orus",
        "vi-VN-Chirp3-HD-Orus",
        "vi-VN-Chirp3-HD-Orus",
    ]
    assert "Một là, về đất đai, phải định lại phép quân điền." in segments[1].text
    assert "Hai là, quan trọng hơn, phải cởi trói cho thương nghiệp." in segments[2].text
    assert all("Nguyễn Bỉnh Khiêm." not in segment.text for segment in segments[:3])
    assert segments[3].kind == "narration"
    assert segments[3].voice == "vi-VN-Chirp3-HD-Charon"


def test_dash_bullets_after_narration_stay_narration():
    content = (
        "Vua Mạc Đăng Dung họp triều.\n\n"
        "- Một là củng cố biên giới.\n\n"
        "– Hai là mở cửa biển."
    )

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert len(segments) == 3
    assert all(segment.kind == "narration" for segment in segments)
    assert all(segment.speaker is None for segment in segments)
    assert "Một là củng cố biên giới." in segments[1].text
    assert "Hai là mở cửa biển." in segments[2].text


def test_italic_paragraphs_continue_previous_speaker_without_dash():
    content = (
        "THOMAS CROMWELL *(Giọng lạnh lùng, dứt khoát)* "
        "Bệ hạ, để hợp thức hóa việc tách rời hoàn toàn với Rome, "
        "bộ luật này quy định rất rõ:\n\n"
        "*Điều thứ nhất: Vua, người kế vị và hậu duệ của ngài từ nay "
        "chính là Nguyên thủ tối cao của Giáo hội Anh. Không phải Giáo hoàng.*\n\n"
        "*Điều thứ hai: Ngài sẽ có đầy đủ thẩm quyền bổ nhiệm Giám mục.*\n\n"
        "*Điều thứ ba: Mọi thẩm quyền giáo hội trước đây thuộc về Rome "
        "nay thuộc về ngài.*\n\n"
        "AFONSO DE ALBUQUERQUE (58 tuổi) đứng trên mũi soái hạm."
    )

    segments = tts.chapter_audio_segments(
        content,
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        glossary_voices={"thomas cromwell": "vi-VN-Chirp3-HD-Orus"},
        narrator_gender="male",
    )

    assert len(segments) == 5
    assert [segment.kind for segment in segments] == [
        "dialogue",
        "dialogue",
        "dialogue",
        "dialogue",
        "narration",
    ]
    assert [segment.speaker for segment in segments[:4]] == ["Thomas Cromwell"] * 4
    assert [segment.voice for segment in segments[:4]] == ["vi-VN-Chirp3-HD-Orus"] * 4
    assert "Bệ hạ, để hợp thức hóa" in segments[0].text
    assert "Điều thứ nhất:" in segments[1].text
    assert "Điều thứ hai:" in segments[2].text
    assert "Điều thứ ba:" in segments[3].text
    assert all("Thomas Cromwell." not in segment.text for segment in segments[:4])
    assert 'pitch="-1st"' in segments[0].text  # lạnh lùng cue on opening line
    assert segments[4].kind == "narration"


def test_horizontal_bar_and_minus_dashes_continue_speaker():
    content = (
        "COLUMBUS Nhân danh Chúa.\n\n"
        "― Điểm một: giữ vững boong tàu.\n\n"
        "− Điểm hai: không được rút lui."
    )

    segments = tts.chapter_audio_segments(
        content,
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        glossary_voices={"columbus": "vi-VN-Chirp3-HD-Orus"},
    )

    assert [segment.kind for segment in segments] == ["dialogue", "dialogue", "dialogue"]
    assert [segment.speaker for segment in segments] == ["Columbus"] * 3
    assert "Điểm một: giữ vững boong tàu." in segments[1].text
    assert "Điểm hai: không được rút lui." in segments[2].text


def test_chirp3_assigns_unique_character_personas():
    content = (
        "COLUMBUS Nhân danh Chúa!\n\n"
        "VASCO DA GAMA Chúng ta đã đến.\n\n"
        "NGƯỜI THƯ KÝ Thưa ông."
    )

    segments = tts.chapter_audio_segments(
        content,
        "vi-VN-Chirp3-HD-Charon",
        engine="chirp3",
        glossary_voices={
            "columbus": "vi-VN-Chirp3-HD-Orus",
            "vasco da gama": "vi-VN-Chirp3-HD-Puck",
            "nguoi thu ky": "vi-VN-Chirp3-HD-Aoede",
        },
    )

    assert [segment.voice for segment in segments] == [
        "vi-VN-Chirp3-HD-Orus",
        "vi-VN-Chirp3-HD-Puck",
        "vi-VN-Chirp3-HD-Aoede",
    ]
    assert all(segment.kind == "dialogue" for segment in segments)


def test_plain_dialogue_detection_does_not_capture_scene_prose():
    content = (
        "VASCO DA GAMA đã đi vào lịch sử như một nhà hàng hải.\n\n"
        "CHRISTOPHER COLUMBUS (51 tuổi) bước chân xuống dòng nước.\n\n"
        "TRÊN BOONG TÀU CARAVEL Duarte Coelho đứng tựa mạn tàu.\n\n"
        "CẬN CẢNH: Một khẩu đại bác được kích nổ.\n\n"
        "LỜI MỞ ĐẦU"
    )

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert len(segments) == 5
    assert all(segment.kind == "narration" for segment in segments)
    assert all(segment.voice == "vi-VN-Neural2-D" for segment in segments)
    assert "Vasco Da Gama đã đi vào lịch sử" in segments[0].text
    assert "Christopher Columbus (51 tuổi)" in segments[1].text
    assert "Trên Boong Tàu Caravel" in segments[2].text


def test_all_caps_words_are_spoken_as_words_not_letters():
    content = (
        "BƯỚC CHÂN TRÊN CÁT CALICUT - THÁNG 5/1498\n\n"
        "Bờ biển Calicut, Ấn Độ. VASCO DA GAMA đã đi vào lịch sử.\n\n"
        "CUỘC DI DÂN SAU ĐỨT GÃY - NGOẠI VI TÂY ĐÔ\n\n"
        "VUA FERDINAND II ngự trên ngai, châu Âu đầu thế kỷ XVI.\n\n"
        "Đông Ấn Hà Lan (VOC) tranh giành với Đông Ấn Anh (EIC)."
    )

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert "Bước Chân Trên Cát Calicut - Tháng 5/1498" in segments[0].text
    assert segments[1].text.endswith("Vasco Da Gama đã đi vào lịch sử.</prosody></speak>")
    # DI and VI are Vietnamese words here, not roman numerals.
    assert "Cuộc Di Dân Sau Đứt Gãy - Ngoại Vi Tây Đô" in segments[2].text
    # Roman numerals stay uppercase so they keep reading as numbers.
    assert "Vua Ferdinand II ngự trên ngai, châu Âu đầu thế kỷ XVI." in segments[3].text
    # Genuine initialisms stay uppercase so they keep being spelled out.
    assert "Đông Ấn Hà Lan (VOC) tranh giành với Đông Ấn Anh (EIC)." in segments[4].text


def test_synthesize_segment_reuses_cached_file(tmp_path, monkeypatch):
    settings = Settings(
        google_tts_enabled=True,
        google_tts_engine="neural2",
        google_tts_gender="male",
        tts_cache_dir=str(tmp_path),
    )
    segment = tts.chapter_audio_segments("Xin chào.", settings.resolved_tts_voice)[0]
    calls = 0

    class FakeClient:
        def synthesize_speech(self, **_kwargs):
            nonlocal calls
            calls += 1
            return type("Response", (), {"audio_content": b"fake-mp3"})()

    monkeypatch.setattr(tts, "_client", lambda: FakeClient())

    first = tts.synthesize_segment(settings, segment, settings.resolved_tts_voice)
    second = tts.synthesize_segment(settings, segment, settings.resolved_tts_voice)

    assert first == second
    assert first.read_bytes() == b"fake-mp3"
    assert calls == 1
    assert settings.resolved_tts_voice == "vi-VN-Neural2-D"
    assert segment.voice == "vi-VN-Neural2-D"
    assert segment.is_ssml is True


def test_resolve_voice_engine_gender_and_overrides():
    assert tts.resolve_voice("standard", "female") == "vi-VN-Standard-A"
    assert tts.resolve_voice("wavenet", "male") == "vi-VN-Wavenet-D"
    assert tts.resolve_voice("neural2", "female") == "vi-VN-Neural2-A"
    assert tts.resolve_voice("chirp3", "male") == "vi-VN-Chirp3-HD-Charon"
    assert (
        tts.resolve_voice("chirp3", "female", chirp_persona="Aoede")
        == "vi-VN-Chirp3-HD-Aoede"
    )
    assert (
        tts.resolve_voice(
            "neural2",
            "male",
            voice_override="vi-VN-Standard-B",
        )
        == "vi-VN-Standard-B"
    )
    assert tts.infer_engine_from_voice("vi-VN-Chirp3-HD-Kore") == "chirp3"
    assert tts.gender_voice_pool("chirp3", "male", "vi-VN-Chirp3-HD-Charon") == [
        "vi-VN-Chirp3-HD-Puck",
        "vi-VN-Chirp3-HD-Orus",
    ]
    assert tts.gender_voice_pool("neural2", "male", "vi-VN-Neural2-D") == [
        "vi-VN-Neural2-D",
    ]


def test_prepare_chapter_audio_generates_once_and_serves_cache(
    client,
    db_session,
    seeded,
    tmp_path,
    monkeypatch,
):
    now = datetime.now(timezone.utc)
    book = Book(
        id=generate(),
        publisher_id=seeded["publisher"].id,
        category_id=seeded["fiction"].id,
        title="Audio Book",
        description="",
        price_cents=0,
        status="published",
        raw_text="Nội dung",
        created_at=now,
        updated_at=now,
    )
    chapter = Chapter(
        id=generate(),
        book_id=book.id,
        position=1,
        title="Chapter 1",
        content="Đây là đoạn thứ nhất.\n\nĐây là đoạn thứ hai.",
        word_count=10,
        group_index=1,
    )
    db_session.add_all([book, chapter])
    db_session.commit()

    settings = Settings(
        google_tts_enabled=True,
        google_tts_engine="neural2",
        google_tts_gender="male",
        tts_cache_dir=str(tmp_path),
    )
    prepare_calls = 0

    def fake_prepare(fake_settings, segments, voice):
        nonlocal prepare_calls
        prepare_calls += 1
        assert voice == "vi-VN-Neural2-D"
        for segment in segments:
            path = tts.cache_path(fake_settings, segment)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"audio-{segment.index}".encode())

    monkeypatch.setattr(books, "get_settings", lambda: settings)
    monkeypatch.setattr(tts, "prepare_segments", fake_prepare)

    endpoint = f"/api/books/{book.id}/chapters/{chapter.id}/audio"
    first = client.post(endpoint)
    second = client.post(endpoint)

    assert first.status_code == 200
    assert first.json()["voice"] == "vi-VN-Neural2-D"
    assert first.json()["engine"] == "neural2"
    assert first.json()["gender"] == "male"
    assert first.json()["cache_hit"] is False
    assert [item["paragraph_index"] for item in first.json()["segments"]] == [0, 1]
    assert second.status_code == 200
    assert second.json()["cache_hit"] is True
    assert prepare_calls == 1

    audio = client.get(first.json()["segments"][0]["url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/mpeg"
    assert audio.content == b"audio-0"


def test_tts_options_endpoint(client):
    response = client.get("/api/tts/options")
    assert response.status_code == 200
    payload = response.json()
    assert {item["id"] for item in payload["engines"]} == {
        "standard",
        "wavenet",
        "neural2",
        "chirp3",
    }
    assert len(payload["voices"]) == 8
    assert payload["active"]["source"] == "env"


def test_admin_can_update_tts_settings_dynamically(client, db_session, seeded):
    from app.auth import mint_dev_id_token

    now = datetime.now(timezone.utc)
    admin = User(
        id=generate(),
        firebase_uid=f"dev-{generate()}",
        email="admin@read.app",
        name="Admin",
        role="admin",
        password_hash=hash_password("admin123"),
        created_at=now,
    )
    db_session.add(admin)
    db_session.commit()

    token = mint_dev_id_token(
        uid=admin.firebase_uid or f"dev-{admin.id}",
        email=admin.email,
        name=admin.name,
    )
    headers = {"Authorization": f"Bearer {token}"}

    denied = client.get("/api/admin/settings/tts")
    assert denied.status_code == 401

    current = client.get("/api/admin/settings/tts", headers=headers)
    assert current.status_code == 200
    assert current.json()["active"]["engine"] == "neural2"

    updated = client.put(
        "/api/admin/settings/tts",
        headers=headers,
        json={
            "engine": "chirp3",
            "gender": "female",
            "chirp_persona": "Aoede",
            "narrator_rate": 97,
            "break_start_ms": 200,
            "break_end_ms": 100,
            "speak_speaker_names": False,
            "max_character_voices": 3,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["active"]["voice"] == "vi-VN-Chirp3-HD-Aoede"
    assert updated.json()["active"]["source"] == "database"
    assert updated.json()["active"]["narrator_rate"] == 97
    assert updated.json()["active"]["break_start_ms"] == 200
    assert updated.json()["active"]["max_character_voices"] == 3

    options = client.get("/api/tts/options")
    assert options.status_code == 200
    assert options.json()["active"]["voice"] == "vi-VN-Chirp3-HD-Aoede"
    assert options.json()["active"]["gender"] == "female"
