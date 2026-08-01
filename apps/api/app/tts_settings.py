"""Global TTS voice + narration style settings (admin-tunable)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .config import get_settings
from .models import AppSetting
from . import tts
from .voice_cast import CAST_PERSONAS

TTS_ENGINE_KEY = "tts_engine"
TTS_GENDER_KEY = "tts_gender"
TTS_CHIRP_PERSONA_KEY = "tts_chirp_persona"
TTS_VOICE_OVERRIDE_KEY = "tts_voice_override"

TTS_NARRATOR_RATE_KEY = "tts_narrator_rate"
TTS_NARRATOR_PITCH_KEY = "tts_narrator_pitch"
TTS_DIALOGUE_RATE_KEY = "tts_dialogue_rate"
TTS_DIALOGUE_PITCH_KEY = "tts_dialogue_pitch"
TTS_BREAK_START_MS_KEY = "tts_break_start_ms"
TTS_BREAK_END_MS_KEY = "tts_break_end_ms"
TTS_SPEAK_SPEAKER_NAMES_KEY = "tts_speak_speaker_names"
TTS_SPEAK_STAGE_DIRECTIONS_KEY = "tts_speak_stage_directions"
TTS_MAX_CHARACTER_VOICES_KEY = "tts_max_character_voices"

TTS_SETTING_KEYS = (
    TTS_ENGINE_KEY,
    TTS_GENDER_KEY,
    TTS_CHIRP_PERSONA_KEY,
    TTS_VOICE_OVERRIDE_KEY,
    TTS_NARRATOR_RATE_KEY,
    TTS_NARRATOR_PITCH_KEY,
    TTS_DIALOGUE_RATE_KEY,
    TTS_DIALOGUE_PITCH_KEY,
    TTS_BREAK_START_MS_KEY,
    TTS_BREAK_END_MS_KEY,
    TTS_SPEAK_SPEAKER_NAMES_KEY,
    TTS_SPEAK_STAGE_DIRECTIONS_KEY,
    TTS_MAX_CHARACTER_VOICES_KEY,
)

DEFAULT_NARRATOR_RATE = tts.NARRATOR_RATE
DEFAULT_NARRATOR_PITCH = tts.NARRATOR_PITCH
DEFAULT_DIALOGUE_RATE = tts.DIALOGUE_BASE_RATE
DEFAULT_DIALOGUE_PITCH = tts.DIALOGUE_BASE_PITCH
DEFAULT_BREAK_START_MS = tts.DIALOGUE_BREAK_START_MS
DEFAULT_BREAK_END_MS = tts.DIALOGUE_BREAK_END_MS
DEFAULT_MAX_CHARACTER_VOICES = 3


@dataclass(frozen=True)
class ActiveTts:
    engine: str
    gender: str
    chirp_persona: str
    voice_override: str
    voice: str
    enabled: bool
    source: str  # "database" | "env"
    narrator_rate: int = DEFAULT_NARRATOR_RATE
    narrator_pitch: int = DEFAULT_NARRATOR_PITCH
    dialogue_rate: int = DEFAULT_DIALOGUE_RATE
    dialogue_pitch: int = DEFAULT_DIALOGUE_PITCH
    break_start_ms: int = DEFAULT_BREAK_START_MS
    break_end_ms: int = DEFAULT_BREAK_END_MS
    speak_speaker_names: bool = True
    speak_stage_directions: bool = True
    max_character_voices: int = DEFAULT_MAX_CHARACTER_VOICES

    def narration_style(self) -> tts.NarrationStyle:
        return tts.NarrationStyle(
            narrator_rate=self.narrator_rate,
            narrator_pitch=self.narrator_pitch,
            dialogue_rate=self.dialogue_rate,
            dialogue_pitch=self.dialogue_pitch,
            break_start_ms=self.break_start_ms,
            break_end_ms=self.break_end_ms,
            speak_speaker_names=self.speak_speaker_names,
            speak_stage_directions=self.speak_stage_directions,
            max_character_voices=self.max_character_voices,
        )


def _rows(db: Session) -> dict[str, str]:
    return {
        row.key: row.value
        for row in db.query(AppSetting).filter(AppSetting.key.in_(TTS_SETTING_KEYS)).all()
    }


def _int_setting(rows: dict[str, str], key: str, default: int, *, lo: int, hi: int) -> int:
    raw = rows.get(key)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(lo, min(hi, value))


def _bool_setting(rows: dict[str, str], key: str, default: bool = False) -> bool:
    raw = rows.get(key)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def get_active_tts(db: Session | None = None) -> ActiveTts:
    settings = get_settings()
    rows = _rows(db) if db is not None else {}
    has_db = any(key in rows for key in TTS_SETTING_KEYS)

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
        narrator_rate=_int_setting(
            rows, TTS_NARRATOR_RATE_KEY, DEFAULT_NARRATOR_RATE, lo=80, hi=120
        ),
        narrator_pitch=_int_setting(
            rows, TTS_NARRATOR_PITCH_KEY, DEFAULT_NARRATOR_PITCH, lo=-6, hi=6
        ),
        dialogue_rate=_int_setting(
            rows, TTS_DIALOGUE_RATE_KEY, DEFAULT_DIALOGUE_RATE, lo=80, hi=120
        ),
        dialogue_pitch=_int_setting(
            rows, TTS_DIALOGUE_PITCH_KEY, DEFAULT_DIALOGUE_PITCH, lo=-6, hi=6
        ),
        break_start_ms=_int_setting(
            rows, TTS_BREAK_START_MS_KEY, DEFAULT_BREAK_START_MS, lo=0, hi=800
        ),
        break_end_ms=_int_setting(
            rows, TTS_BREAK_END_MS_KEY, DEFAULT_BREAK_END_MS, lo=0, hi=800
        ),
        speak_speaker_names=_bool_setting(rows, TTS_SPEAK_SPEAKER_NAMES_KEY, True),
        speak_stage_directions=_bool_setting(rows, TTS_SPEAK_STAGE_DIRECTIONS_KEY, True),
        max_character_voices=_int_setting(
            rows, TTS_MAX_CHARACTER_VOICES_KEY, DEFAULT_MAX_CHARACTER_VOICES, lo=1, hi=6
        ),
    )


def _upsert_values(db: Session, values: dict[str, str], admin_id: str | None) -> None:
    now = datetime.now(timezone.utc)
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


def upsert_tts_settings(
    db: Session,
    *,
    engine: str,
    gender: str,
    chirp_persona: str = "",
    voice_override: str = "",
    narrator_rate: int | None = None,
    narrator_pitch: int | None = None,
    dialogue_rate: int | None = None,
    dialogue_pitch: int | None = None,
    break_start_ms: int | None = None,
    break_end_ms: int | None = None,
    speak_speaker_names: bool | None = None,
    speak_stage_directions: bool | None = None,
    max_character_voices: int | None = None,
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
        if chirp_persona in tts.CHIRP3_PERSONAS["female"]:
            gender = "female"
        elif chirp_persona in tts.CHIRP3_PERSONAS["male"]:
            gender = "male"
    elif engine != "chirp3":
        chirp_persona = ""

    current = get_active_tts(db)

    def pick_int(value: int | None, fallback: int, *, lo: int, hi: int) -> int:
        raw = fallback if value is None else int(value)
        return max(lo, min(hi, raw))

    values = {
        TTS_ENGINE_KEY: engine,
        TTS_GENDER_KEY: gender,
        TTS_CHIRP_PERSONA_KEY: chirp_persona,
        TTS_VOICE_OVERRIDE_KEY: voice_override,
        TTS_NARRATOR_RATE_KEY: str(
            pick_int(narrator_rate, current.narrator_rate, lo=80, hi=120)
        ),
        TTS_NARRATOR_PITCH_KEY: str(
            pick_int(narrator_pitch, current.narrator_pitch, lo=-6, hi=6)
        ),
        TTS_DIALOGUE_RATE_KEY: str(
            pick_int(dialogue_rate, current.dialogue_rate, lo=80, hi=120)
        ),
        TTS_DIALOGUE_PITCH_KEY: str(
            pick_int(dialogue_pitch, current.dialogue_pitch, lo=-6, hi=6)
        ),
        TTS_BREAK_START_MS_KEY: str(
            pick_int(break_start_ms, current.break_start_ms, lo=0, hi=800)
        ),
        TTS_BREAK_END_MS_KEY: str(
            pick_int(break_end_ms, current.break_end_ms, lo=0, hi=800)
        ),
        TTS_SPEAK_SPEAKER_NAMES_KEY: (
            "true"
            if (
                current.speak_speaker_names
                if speak_speaker_names is None
                else bool(speak_speaker_names)
            )
            else "false"
        ),
        TTS_SPEAK_STAGE_DIRECTIONS_KEY: (
            "true"
            if (
                current.speak_stage_directions
                if speak_stage_directions is None
                else bool(speak_stage_directions)
            )
            else "false"
        ),
        TTS_MAX_CHARACTER_VOICES_KEY: str(
            pick_int(
                max_character_voices,
                current.max_character_voices,
                lo=1,
                hi=6,
            )
        ),
    }
    _upsert_values(db, values, admin_id)
    db.commit()
    return get_active_tts(db)


def active_payload(active: ActiveTts) -> dict:
    return {
        "engine": active.engine,
        "gender": active.gender,
        "chirp_persona": active.chirp_persona,
        "voice_override": active.voice_override,
        "voice": active.voice,
        "enabled": active.enabled,
        "source": active.source,
        "narrator_rate": active.narrator_rate,
        "narrator_pitch": active.narrator_pitch,
        "dialogue_rate": active.dialogue_rate,
        "dialogue_pitch": active.dialogue_pitch,
        "break_start_ms": active.break_start_ms,
        "break_end_ms": active.break_end_ms,
        "speak_speaker_names": active.speak_speaker_names,
        "speak_stage_directions": active.speak_stage_directions,
        "max_character_voices": active.max_character_voices,
    }


def tts_settings_payload(db: Session) -> dict:
    active = get_active_tts(db)
    return {
        "engines": [
            {"id": engine, "label": label}
            for engine, label in tts.ENGINE_LABELS.items()
        ],
        "genders": ["male", "female"],
        "age_bands": ["youth", "adult", "elder"],
        "presences": ["soft", "neutral", "forceful"],
        "chirp3_personas": tts.CHIRP3_PERSONAS,
        "cast_personas": {
            "male": list(CAST_PERSONAS["male"]),
            "female": list(CAST_PERSONAS["female"]),
        },
        "voices": tts.voice_options(),
        "defaults": {
            "narrator_rate": DEFAULT_NARRATOR_RATE,
            "narrator_pitch": DEFAULT_NARRATOR_PITCH,
            "dialogue_rate": DEFAULT_DIALOGUE_RATE,
            "dialogue_pitch": DEFAULT_DIALOGUE_PITCH,
            "break_start_ms": DEFAULT_BREAK_START_MS,
            "break_end_ms": DEFAULT_BREAK_END_MS,
            "max_character_voices": DEFAULT_MAX_CHARACTER_VOICES,
        },
        "active": active_payload(active),
    }
