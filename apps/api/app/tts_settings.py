from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .config import get_settings
from .models import AppSetting
from . import tts

TTS_ENGINE_KEY = "tts_engine"
TTS_GENDER_KEY = "tts_gender"
TTS_CHIRP_PERSONA_KEY = "tts_chirp_persona"
TTS_VOICE_OVERRIDE_KEY = "tts_voice_override"

TTS_SETTING_KEYS = (
    TTS_ENGINE_KEY,
    TTS_GENDER_KEY,
    TTS_CHIRP_PERSONA_KEY,
    TTS_VOICE_OVERRIDE_KEY,
)


@dataclass(frozen=True)
class ActiveTts:
    engine: str
    gender: str
    chirp_persona: str
    voice_override: str
    voice: str
    enabled: bool
    source: str  # "database" | "env"


def _rows(db: Session) -> dict[str, str]:
    return {
        row.key: row.value
        for row in db.query(AppSetting).filter(AppSetting.key.in_(TTS_SETTING_KEYS)).all()
    }


def get_active_tts(db: Session | None = None) -> ActiveTts:
    settings = get_settings()
    rows = _rows(db) if db is not None else {}
    has_db = any(key in rows for key in (TTS_ENGINE_KEY, TTS_GENDER_KEY, TTS_CHIRP_PERSONA_KEY, TTS_VOICE_OVERRIDE_KEY))

    engine = rows.get(TTS_ENGINE_KEY) or settings.google_tts_engine
    gender = rows.get(TTS_GENDER_KEY) or settings.google_tts_gender
    chirp_persona = (
        rows[TTS_CHIRP_PERSONA_KEY]
        if TTS_CHIRP_PERSONA_KEY in rows
        else settings.google_tts_chirp_persona
    )
    voice_override = (
        rows[TTS_VOICE_OVERRIDE_KEY]
        if TTS_VOICE_OVERRIDE_KEY in rows
        else settings.google_tts_voice
    )

    engine = tts.normalize_engine(engine)
    gender = tts.normalize_gender(gender)
    voice = tts.resolve_voice(
        engine,
        gender,
        chirp_persona=chirp_persona,
        voice_override=voice_override,
    )
    return ActiveTts(
        engine=engine,
        gender=gender,
        chirp_persona=chirp_persona.strip(),
        voice_override=voice_override.strip(),
        voice=voice,
        enabled=settings.google_tts_enabled,
        source="database" if has_db else "env",
    )


def upsert_tts_settings(
    db: Session,
    *,
    engine: str,
    gender: str,
    chirp_persona: str = "",
    voice_override: str = "",
    admin_id: str | None = None,
) -> ActiveTts:
    engine = tts.normalize_engine(engine)
    gender = tts.normalize_gender(gender)
    chirp_persona = chirp_persona.strip()
    voice_override = voice_override.strip()

    if engine == "chirp3" and chirp_persona:
        allowed = set(tts.CHIRP3_PERSONAS["male"]) | set(tts.CHIRP3_PERSONAS["female"])
        if chirp_persona not in allowed:
            raise ValueError(f"Unknown Chirp3 persona {chirp_persona!r}.")
        # Keep gender consistent with the persona when possible.
        if chirp_persona in tts.CHIRP3_PERSONAS["female"]:
            gender = "female"
        elif chirp_persona in tts.CHIRP3_PERSONAS["male"]:
            gender = "male"
    elif engine != "chirp3":
        chirp_persona = ""

    # Choosing engine/gender clears any hard voice override from the admin UI.
    if not voice_override:
        voice_override = ""

    now = datetime.now(timezone.utc)
    values = {
        TTS_ENGINE_KEY: engine,
        TTS_GENDER_KEY: gender,
        TTS_CHIRP_PERSONA_KEY: chirp_persona,
        TTS_VOICE_OVERRIDE_KEY: voice_override,
    }
    for key, value in values.items():
        row = db.get(AppSetting, key)
        if row is None:
            db.add(
                AppSetting(
                    key=key,
                    value=value,
                    updated_at=now,
                    updated_by=admin_id,
                )
            )
        else:
            row.value = value
            row.updated_at = now
            row.updated_by = admin_id
    db.commit()
    return get_active_tts(db)


def tts_settings_payload(db: Session) -> dict:
    active = get_active_tts(db)
    return {
        "engines": [
            {"id": engine, "label": label}
            for engine, label in tts.ENGINE_LABELS.items()
        ],
        "genders": ["male", "female"],
        "chirp3_personas": tts.CHIRP3_PERSONAS,
        "voices": tts.voice_options(),
        "active": {
            "engine": active.engine,
            "gender": active.gender,
            "chirp_persona": active.chirp_persona,
            "voice_override": active.voice_override,
            "voice": active.voice,
            "enabled": active.enabled,
            "source": active.source,
        },
    }
