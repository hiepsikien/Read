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
    assert segments[0].text == "Mở đầu Đọc thêm tại."
    assert all(len(segment.text.encode("utf-8")) <= tts.MAX_TTS_INPUT_BYTES for segment in segments)
    assert all(segment.cache_key for segment in segments)


def test_screenplay_dialogue_keeps_direction_with_pause_and_prosody():
    content = (
        "COLUMBUS *(Giọng khàn đặc nhưng vang dội)* "
        "Nhân danh Chúa Kitô cứu thế!\n\n"
        "NGƯỜI THƯ KÝ (Hộ tống) *(Thì thầm, mắt đầy kinh ngạc)* "
        "Thưa thuyền trưởng, đây là Calicut.\n\n"
        "AFONSO DE ALBUQUERQUE (58 tuổi) đứng trên mũi soái hạm."
    )

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert len(segments) == 3
    assert segments[0].is_ssml is True
    assert '<break time="300ms"/>' in segments[0].text
    assert '<break time="450ms"/>' in segments[0].text
    assert "Columbus." in segments[0].text
    assert "Giọng khàn đặc nhưng vang dội." in segments[0].text
    assert "Nhân danh Chúa Kitô cứu thế!" in segments[0].text
    assert 'pitch="-2st"' in segments[0].text

    assert segments[1].is_ssml is True
    assert "Người Thư Ký." in segments[1].text
    assert "Hộ tống." in segments[1].text
    assert "Thì thầm, mắt đầy kinh ngạc." in segments[1].text
    assert 'rate="88%"' in segments[1].text
    assert 'volume="-4dB"' in segments[1].text

    # Ordinary prose with a parenthetical age must stay plain narration.
    assert segments[2].is_ssml is False
    assert "Afonso De Albuquerque (58 tuổi) đứng trên mũi soái hạm." == segments[2].text


def test_leading_stage_direction_is_kept_with_pause():
    content = "*(Ông nhìn ra đại dương bao la phía sau)* Hãy nhìn cho kỹ."

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert len(segments) == 1
    assert segments[0].is_ssml is True
    assert "Ông nhìn ra đại dương bao la phía sau." in segments[0].text
    assert '<break time="450ms"/>' in segments[0].text
    assert "Hãy nhìn cho kỹ." in segments[0].text


def test_screenplay_dialogue_without_direction_keeps_speaker_and_neutral_style():
    content = (
        "LÊ THÁNH TÔNG Ta giao cho con một bờ cõi thái bình.\n\n"
        "VASCO DA GAMA Chúng ta đã chạm tay vào nguồn gốc của thế giới.\n\n"
        "NGƯỜI THƯ KÝ Thưa ông, đó là tuyên chiến.\n\n"
        "NỘI THỊ Bẩm Thái sư, xin dùng canh."
    )

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert len(segments) == 4
    assert all(segment.is_ssml for segment in segments)
    assert "Lê Thánh Tông." in segments[0].text
    assert "Ta giao cho con một bờ cõi thái bình." in segments[0].text
    assert "Vasco Da Gama." in segments[1].text
    assert "Người Thư Ký." in segments[2].text
    assert "Nội Thị." in segments[3].text
    assert all('<break time="300ms"/>' in segment.text for segment in segments)
    assert all('rate="100%"' in segment.text for segment in segments)


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
    assert all(not segment.is_ssml for segment in segments)
    assert segments[0].text.startswith("Vasco Da Gama đã đi vào lịch sử")
    assert segments[1].text.startswith("Christopher Columbus (51 tuổi)")
    assert segments[2].text.startswith("Trên Boong Tàu Caravel")


def test_all_caps_words_are_spoken_as_words_not_letters():
    content = (
        "BƯỚC CHÂN TRÊN CÁT CALICUT - THÁNG 5/1498\n\n"
        "Bờ biển Calicut, Ấn Độ. VASCO DA GAMA đã đi vào lịch sử.\n\n"
        "CUỘC DI DÂN SAU ĐỨT GÃY - NGOẠI VI TÂY ĐÔ\n\n"
        "VUA FERDINAND II ngự trên ngai, châu Âu đầu thế kỷ XVI.\n\n"
        "Đông Ấn Hà Lan (VOC) tranh giành với Đông Ấn Anh (EIC)."
    )

    segments = tts.chapter_audio_segments(content, "vi-VN-Neural2-D")

    assert segments[0].text == "Bước Chân Trên Cát Calicut - Tháng 5/1498"
    assert segments[1].text.endswith("Vasco Da Gama đã đi vào lịch sử.")
    # DI and VI are Vietnamese words here, not roman numerals.
    assert segments[2].text == "Cuộc Di Dân Sau Đứt Gãy - Ngoại Vi Tây Đô"
    # Roman numerals stay uppercase so they keep reading as numbers.
    assert segments[3].text == "Vua Ferdinand II ngự trên ngai, châu Âu đầu thế kỷ XVI."
    # Genuine initialisms stay uppercase so they keep being spelled out.
    assert segments[4].text == "Đông Ấn Hà Lan (VOC) tranh giành với Đông Ấn Anh (EIC)."


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
        json={"engine": "chirp3", "gender": "female", "chirp_persona": "Aoede"},
    )
    assert updated.status_code == 200
    assert updated.json()["active"]["voice"] == "vi-VN-Chirp3-HD-Aoede"
    assert updated.json()["active"]["source"] == "database"

    options = client.get("/api/tts/options")
    assert options.status_code == 200
    assert options.json()["active"]["voice"] == "vi-VN-Chirp3-HD-Aoede"
    assert options.json()["active"]["gender"] == "female"
