"""Infer character gender/age from glossary profiles and assign stable TTS voices."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .glossary import aliases_from_storage, normalize_lookup
from . import tts

# Curated Chirp3 pool. Age band picks a preferred slot among the first 3;
# collisions walk the same-gender list so casts stay gender-correct.
# Cap for admin "max character voices". Pool length is CAST_PERSONAS per gender.
MAX_CHARACTER_VOICES_CAP = 12

CAST_PERSONAS: dict[str, list[str]] = {
    # First 3 keep youth → adult → elder slots used when max_voices is small.
    # Remaining Chirp personas expand distinct cast capacity (admin max up to 12).
    "male": [
        "Puck",
        "Orus",
        "Charon",
        "Achird",
        "Algenib",
        "Enceladus",
        "Fenrir",
        "Algieba",
        "Iapetus",
        "Schedar",
        "Umbriel",
        "Alnilam",
    ],
    "female": [
        "Zephyr",
        "Aoede",
        "Kore",
        "Leda",
        "Achernar",
        "Autonoe",
        "Callirrhoe",
        "Sulafat",
        "Despina",
        "Erinome",
        "Laomedeia",
        "Gacrux",
    ],
}

AGE_INDEX = {"youth": 0, "adult": 1, "elder": 2}

_MALE_CUES = re.compile(
    r"(?:"
    r"minh quân|chúa tiên|chúa|vua|hoàng đế|hoàng tử|thái tử|công tử|"
    r"đô đốc|thuyền trưởng|tướng quân|tướng lĩnh|tướng|nam tước|cậu bé|cậu|"
    r"nam giới|ông\b|đức ông|linh mục|hồng y|giáo sĩ|nhà thám hiểm|"
    r"luật gia|sứ thần|nam nhi|phu quân|hoàng thượng|thống đốc|phó vương"
    r")",
    re.IGNORECASE,
)
_FEMALE_CUES = re.compile(
    r"(?:"
    r"công chúa|thái hậu|hoàng hậu|nữ hoàng|phu nhân|công nương|"
    r"thị nữ|nữ quan|nữ sĩ|nữ tướng|thiếu nữ|cô gái|bà\b|cô\b|"
    r"nữ giới|nữ\b|hoàng phi|vương phi|thị vệ nữ"
    r")",
    re.IGNORECASE,
)
_YOUTH_CUES = re.compile(
    r"(?:thiếu niên|thiếu nữ|niên thiếu|trẻ tuổi|cậu bé|cô gái|trẻ|"
    r"thiếu thời|tuổi trẻ|còn trẻ)",
    re.IGNORECASE,
)
_ELDER_CUES = re.compile(
    r"(?:lão|già|cao tuổi|về già|cuối đời|bô lão|lão tướng|"
    r"già nua|tuổi già|lão thần)",
    re.IGNORECASE,
)
_FORCEFUL_CUES = re.compile(
    r"(?:"
    r"mãnh tướng|mãnh|sư tử|cứng rắn|uy nghi|uy nghiêm|sắt đá|"
    r"đô đốc|tướng lĩnh|tướng quân|thống đốc|pháo đài|armada|"
    r"chiến lược|quân sự|hạm đội|chinh phạt|bách chiến"
    r")",
    re.IGNORECASE,
)
_SOFT_CUES = re.compile(
    r"(?:"
    r"thi sĩ|nhà thơ|êm đềm|dịu dàng|mềm mại|tu sĩ|ẩn sĩ|"
    r"hiền hòa|trầm lắng nhẹ"
    r")",
    re.IGNORECASE,
)
_YEAR_SPAN_RE = re.compile(
    r"(?:k\.?\s*)?(\d{3,4})\s*[–—-]\s*(?:k\.?\s*)?(?:\d{3,4}|\?)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class CastProfile:
    gender: str  # male | female
    age_band: str  # youth | adult | elder
    voice: str
    presence: str = "neutral"  # soft | neutral | forceful


def infer_gender(name: str, summary: str = "") -> str:
    blob = f"{name} {summary}"
    female_hit = bool(_FEMALE_CUES.search(blob))
    male_hit = bool(_MALE_CUES.search(blob))
    if female_hit and not male_hit:
        return "female"
    if male_hit and not female_hit:
        return "male"
    # Vietnamese given-name patterns.
    if re.search(r"\bThị\b", name):
        return "female"
    if re.search(r"\bVăn\b", name):
        return "male"
    if female_hit and male_hit:
        # Prefer the more specific royal/rank cue order by scanning left-to-right.
        female_at = _FEMALE_CUES.search(blob)
        male_at = _MALE_CUES.search(blob)
        if female_at and male_at:
            return "female" if female_at.start() <= male_at.start() else "male"
    return "male"  # historical casts skew male; publisher can override later


def infer_age_band(name: str, summary: str = "") -> str:
    blob = f"{name} {summary}"
    if _YOUTH_CUES.search(blob):
        return "youth"
    if _ELDER_CUES.search(blob):
        return "elder"
    # Forceful commanders lean on the deeper voice slot even when mid-age.
    if _FORCEFUL_CUES.search(blob) and not _SOFT_CUES.search(blob):
        return "elder"
    match = _YEAR_SPAN_RE.search(blob)
    if match:
        try:
            birth = int(match.group(1))
        except ValueError:
            birth = 0
        # Rough era heuristic for 15th–16th c. casts: early birth → elder feel.
        if birth and birth < 1450:
            return "elder"
        if birth and birth >= 1490:
            return "youth"
    return "adult"


def infer_presence(name: str, summary: str = "") -> str:
    blob = f"{name} {summary}"
    forceful = bool(_FORCEFUL_CUES.search(blob))
    soft = bool(_SOFT_CUES.search(blob))
    if forceful and not soft:
        return "forceful"
    if soft and not forceful:
        return "soft"
    return "neutral"


def _first_match(pattern: re.Pattern[str], blob: str) -> str:
    match = pattern.search(blob)
    return match.group(0) if match else ""


def explain_cast_inference(name: str, summary: str = "") -> tuple[dict[str, str], str]:
    """Return inferred attrs plus a short Vietnamese rationale for the admin UI."""
    blob = f"{name} {summary}".strip()
    gender = infer_gender(name, summary)
    age_band = infer_age_band(name, summary)
    presence = infer_presence(name, summary)

    gender_bits: list[str] = []
    female_hit = _first_match(_FEMALE_CUES, blob)
    male_hit = _first_match(_MALE_CUES, blob)
    if gender == "female":
        if female_hit:
            gender_bits.append(f'nữ (gợi ý “{female_hit}”)')
        elif re.search(r"\bThị\b", name or ""):
            gender_bits.append("nữ (tên có “Thị”)")
        else:
            gender_bits.append("nữ")
    else:
        if male_hit:
            gender_bits.append(f'nam (gợi ý “{male_hit}”)')
        elif re.search(r"\bVăn\b", name or ""):
            gender_bits.append("nam (tên có “Văn”)")
        else:
            gender_bits.append("nam (mặc định khi thiếu tín hiệu rõ)")

    age_bits: list[str] = []
    youth_hit = _first_match(_YOUTH_CUES, blob)
    elder_hit = _first_match(_ELDER_CUES, blob)
    year_hit = _YEAR_SPAN_RE.search(blob)
    forceful_hit = _first_match(_FORCEFUL_CUES, blob)
    soft_hit = _first_match(_SOFT_CUES, blob)
    if age_band == "youth":
        if youth_hit:
            age_bits.append(f'trẻ (gợi ý “{youth_hit}”)')
        elif year_hit:
            age_bits.append(f"trẻ (năm sinh ~{year_hit.group(1)})")
        else:
            age_bits.append("trẻ")
    elif age_band == "elder":
        if elder_hit:
            age_bits.append(f'già (gợi ý “{elder_hit}”)')
        elif forceful_hit and not soft_hit:
            age_bits.append(f'già/trầm (uy lực “{forceful_hit}”)')
        elif year_hit:
            age_bits.append(f"già (năm sinh ~{year_hit.group(1)})")
        else:
            age_bits.append("già")
    else:
        age_bits.append("trung niên (không có tín hiệu trẻ/già rõ)")

    if presence == "forceful":
        presence_bits = (
            f'presence forceful (gợi ý “{forceful_hit}”)'
            if forceful_hit
            else "presence forceful"
        )
    elif presence == "soft":
        presence_bits = (
            f'presence soft (gợi ý “{soft_hit}”)' if soft_hit else "presence soft"
        )
    else:
        presence_bits = "presence neutral"

    attrs = {"gender": gender, "age_band": age_band, "presence": presence}
    rationale = (
        f"Suy ra {', '.join(gender_bits)}; {', '.join(age_bits)}; {presence_bits}. "
        f"Persona sẽ được chọn theo nhóm {age_band}/{presence} trong pool cùng giới."
    )
    return attrs, rationale


def _chirp_voice(persona: str) -> str:
    return f"vi-VN-Chirp3-HD-{persona}"


def _gender_pool(
    engine: str,
    gender: str,
    narrator_voice: str,
    *,
    max_voices: int = 3,
) -> list[str]:
    engine_key = tts.normalize_engine(engine)
    gender_key = tts.normalize_gender(gender)
    limit = max(1, min(MAX_CHARACTER_VOICES_CAP, int(max_voices)))
    if engine_key == "chirp3":
        personas = CAST_PERSONAS[gender_key][:limit]
        pool = [_chirp_voice(persona) for persona in personas]
    else:
        pool = [tts.VOICE_CATALOG[engine_key][gender_key]]

    others = [voice for voice in pool if voice != narrator_voice]
    return others or pool


def _preferred_index(age_band: str, pool_size: int) -> int:
    if pool_size <= 1:
        return 0
    return min(AGE_INDEX.get(age_band, 1), pool_size - 1)


def assign_voice_for_profile(
    *,
    gender: str,
    age_band: str,
    engine: str,
    narrator_voice: str,
    used: set[str],
    max_voices: int = 3,
) -> str:
    pool = _gender_pool(engine, gender, narrator_voice, max_voices=max_voices)
    start = _preferred_index(age_band, len(pool))
    for offset in range(len(pool)):
        candidate = pool[(start + offset) % len(pool)]
        if candidate not in used:
            return candidate
    return pool[start]


def cast_profiles_for_entries(
    entries: list,
    *,
    engine: str,
    narrator_voice: str,
    max_voices: int = 3,
) -> dict[str, CastProfile]:
    """Build a stable name-key → profile map, deduping across episodes."""
    unique: dict[str, tuple[str, str, str, str, str, bool, list[str], str]] = {}
    for entry in entries:
        name = getattr(entry, "name", "") or ""
        key = normalize_lookup(name)
        if not key:
            continue
        aliases = getattr(entry, "aliases", [])
        if isinstance(aliases, str):
            aliases = aliases_from_storage(aliases)
        summary = getattr(entry, "summary", "") or ""
        existing_gender = (getattr(entry, "gender", "") or "").strip()
        existing_age = (getattr(entry, "age_band", "") or "").strip()
        existing_presence = (getattr(entry, "presence", "") or "").strip()
        locked = bool(getattr(entry, "cast_locked", False))
        existing_voice = (getattr(entry, "tts_voice", "") or "").strip()
        if key not in unique:
            unique[key] = (
                name,
                summary,
                existing_gender,
                existing_age,
                existing_presence,
                locked,
                list(aliases),
                existing_voice,
            )
        else:
            prev = unique[key]
            (
                prev_name,
                prev_summary,
                prev_gender,
                prev_age,
                prev_presence,
                prev_locked,
                prev_aliases,
                prev_voice,
            ) = prev
            merged_aliases = list(dict.fromkeys([*prev_aliases, *list(aliases)]))
            unique[key] = (
                prev_name or name,
                prev_summary or summary,
                prev_gender or existing_gender,
                prev_age or existing_age,
                prev_presence or existing_presence,
                prev_locked or locked,
                merged_aliases,
                prev_voice or existing_voice,
            )

    used: set[str] = set()
    if narrator_voice:
        used.add(narrator_voice)

    profiles: dict[str, CastProfile] = {}
    for key in sorted(unique.keys()):
        (
            name,
            summary,
            existing_gender,
            existing_age,
            existing_presence,
            locked,
            aliases,
            existing_voice,
        ) = unique[key]

        if locked and existing_gender in {"male", "female"}:
            gender = existing_gender
            age_band = existing_age if existing_age in AGE_INDEX else infer_age_band(name, summary)
            presence = (
                existing_presence
                if existing_presence in {"soft", "neutral", "forceful"}
                else infer_presence(name, summary)
            )
            if existing_voice and _voice_matches_gender(existing_voice, gender, engine):
                voice = existing_voice
            else:
                voice = assign_voice_for_profile(
                    gender=gender,
                    age_band=age_band,
                    engine=engine,
                    narrator_voice=narrator_voice,
                    used=used,
                    max_voices=max_voices,
                )
        else:
            gender = (
                existing_gender
                if existing_gender in {"male", "female"}
                else infer_gender(name, summary)
            )
            age_band = infer_age_band(name, summary)
            presence = infer_presence(name, summary)
            voice = assign_voice_for_profile(
                gender=gender,
                age_band=age_band,
                engine=engine,
                narrator_voice=narrator_voice,
                used=used,
                max_voices=max_voices,
            )
        used.add(voice)
        profile = CastProfile(
            gender=gender,
            age_band=age_band,
            voice=voice,
            presence=presence,
        )
        profiles[key] = profile
        for alias in aliases:
            alias_key = normalize_lookup(alias)
            if alias_key:
                profiles[alias_key] = profile
    return profiles


def _voice_matches_gender(voice: str, gender: str, engine: str) -> bool:
    engine_key = tts.normalize_engine(engine)
    gender_key = tts.normalize_gender(gender)
    if engine_key == "chirp3":
        persona = voice.rsplit("-", 1)[-1]
        return persona in tts.CHIRP3_PERSONAS[gender_key] or persona in CAST_PERSONAS[gender_key]
    expected = tts.VOICE_CATALOG[engine_key][gender_key]
    return voice == expected


def apply_cast_to_entries(
    entries: list,
    profiles: dict[str, CastProfile],
    *,
    unlock: bool = False,
) -> int:
    """Write gender/age_band/presence/tts_voice onto ORM rows. Returns updated count."""
    updated = 0
    for entry in entries:
        key = normalize_lookup(getattr(entry, "name", "") or "")
        profile = profiles.get(key)
        if profile is None:
            continue
        if bool(getattr(entry, "cast_locked", False)) and not unlock:
            # Still fill empty fields on locked rows, but don't clobber overrides.
            changed = False
            if not (getattr(entry, "gender", "") or "").strip():
                entry.gender = profile.gender
                changed = True
            if not (getattr(entry, "age_band", "") or "").strip():
                entry.age_band = profile.age_band
                changed = True
            if not (getattr(entry, "presence", "") or "").strip():
                entry.presence = profile.presence
                changed = True
            if not (getattr(entry, "tts_voice", "") or "").strip():
                entry.tts_voice = profile.voice
                changed = True
            if changed:
                updated += 1
            continue
        changed = False
        if getattr(entry, "gender", "") != profile.gender:
            entry.gender = profile.gender
            changed = True
        if getattr(entry, "age_band", "") != profile.age_band:
            entry.age_band = profile.age_band
            changed = True
        if getattr(entry, "presence", "") != profile.presence:
            entry.presence = profile.presence
            changed = True
        if getattr(entry, "tts_voice", "") != profile.voice:
            entry.tts_voice = profile.voice
            changed = True
        if unlock and getattr(entry, "cast_locked", False):
            entry.cast_locked = False
            changed = True
        if changed:
            updated += 1
    return updated


def speaker_voice_lookup(
    entries: list,
    *,
    engine: str,
    narrator_voice: str,
    max_voices: int = 3,
) -> dict[str, str]:
    profiles = cast_profiles_for_entries(
        entries,
        engine=engine,
        narrator_voice=narrator_voice,
        max_voices=max_voices,
    )
    return {key: profile.voice for key, profile in profiles.items()}


def ensure_entries_cast(
    entries: list,
    *,
    engine: str,
    narrator_voice: str,
    max_voices: int = 3,
) -> dict[str, CastProfile]:
    """Fill missing cast fields and return the full profile map."""
    profiles = cast_profiles_for_entries(
        entries,
        engine=engine,
        narrator_voice=narrator_voice,
        max_voices=max_voices,
    )
    apply_cast_to_entries(entries, profiles)
    return profiles
