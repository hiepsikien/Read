"""AI (or heuristic) recommendations for book audio-cast attributes."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .config import Settings
from .gemini import gemini_available, generate_gemini_text
from .glossary import normalize_lookup
from .segment_titles import strip_code_fence
from . import tts
from .voice_cast import (
    CAST_PERSONAS,
    AGE_INDEX,
    assign_voice_for_profile,
    explain_cast_inference,
)

logger = logging.getLogger(__name__)

MAX_SUMMARY_CHARS = 900
MAX_DIALOGUE_SAMPLES = 4
MAX_DIALOGUE_CHARS = 180
MAX_RATIONALE_CHARS = 360

VALID_GENDERS = {"male", "female"}
VALID_AGE = set(AGE_INDEX)
VALID_PRESENCE = {"soft", "neutral", "forceful"}

# Soft flavor tags so the model picks by character feel, not age-slot defaults.
PERSONA_FLAVORS: dict[str, dict[str, str]] = {
    "male": {
        "Puck": "trẻ, nhanh, hơi tinh nghịch",
        "Orus": "trưởng thành, rõ ràng, trung tính",
        "Charon": "già, trầm, uy nghi — chỉ dùng khi thực sự hợp",
        "Achird": "ấm, gần gũi, điềm đạm",
        "Algenib": "sắc, quyết đoán, hơi lạnh",
        "Enceladus": "trầm ấm, suy tư",
        "Fenrir": "mạnh, gai góc, hung",
        "Algieba": "điềm tĩnh, quan sát",
        "Iapetus": "già dặn, chậm rãi, sử thi",
        "Schedar": "sang, nghi lễ, quý tộc",
        "Umbriel": "tối, kín đáo, bí ẩn",
        "Alnilam": "vững, chỉ huy, quân sự",
    },
    "female": {
        "Zephyr": "trẻ, nhẹ, trong",
        "Aoede": "trưởng thành, ấm, kể chuyện",
        "Kore": "già dặn, điềm đạm, sâu",
        "Leda": "mềm, thân mật",
        "Achernar": "sáng, sắc sảo",
        "Autonoe": "lạnh, quý phái",
        "Callirrhoe": "du dương, cảm xúc",
        "Sulafat": "trầm, nghiêm",
        "Despina": "nhanh, linh hoạt",
        "Erinome": "êm, nội tâm",
        "Laomedeia": "uy nghi, nữ chủ",
        "Gacrux": "già, sử thi, trang trọng",
    },
}

# Models over-pick these age-slot defaults; demote when free alternatives exist.
DEFAULT_PERSONA_BIAS = {
    "male": {"Charon", "Orus"},
    "female": {"Kore", "Aoede"},
}


def heuristic_cast_attrs(name: str, summary: str = "") -> dict[str, str]:
    attrs, _rationale = explain_cast_inference(name, summary)
    return attrs


def extract_dialogue_samples(
    chapters: list,
    *,
    speaker_keys: set[str],
    limit: int = MAX_DIALOGUE_SAMPLES,
) -> list[str]:
    """Short dialogue lines spoken by any of the given normalized speaker keys."""
    if not speaker_keys:
        return []
    samples: list[str] = []
    for chapter in sorted(chapters, key=lambda c: getattr(c, "position", 0) or 0):
        content = getattr(chapter, "content", "") or ""
        paragraphs = [
            collapsed
            for paragraph in re.split(r"\n\s*\n", content)
            if (collapsed := re.sub(r"\s*\n\s*", " ", paragraph).strip())
        ]
        for paragraph in paragraphs:
            parsed = tts._parse_screenplay_paragraph(paragraph)
            if not parsed:
                continue
            speaker, _role, _direction, dialogue = parsed
            if not speaker or not dialogue:
                continue
            if normalize_lookup(speaker) not in speaker_keys:
                continue
            line = re.sub(r"\s+", " ", dialogue).strip()
            if len(line) > MAX_DIALOGUE_CHARS:
                line = line[: MAX_DIALOGUE_CHARS - 1].rstrip() + "…"
            if line and line not in samples:
                samples.append(line)
            if len(samples) >= limit:
                return samples
    return samples


def parse_recommendation_payload(raw: str) -> dict[str, Any] | None:
    text = strip_code_fence(raw)
    data: Any
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None

    gender = str(data.get("gender") or "").strip().lower()
    age_band = str(data.get("age_band") or data.get("age") or "").strip().lower()
    presence = str(data.get("presence") or "").strip().lower()
    persona = str(data.get("chirp_persona") or data.get("persona") or "").strip()
    rationale = str(data.get("rationale") or data.get("reason") or "").strip()
    rationale = re.sub(r"\s+", " ", rationale)
    if len(rationale) > MAX_RATIONALE_CHARS:
        rationale = rationale[: MAX_RATIONALE_CHARS - 1].rstrip() + "…"

    if gender not in VALID_GENDERS or age_band not in VALID_AGE or presence not in VALID_PRESENCE:
        return None

    allowed = set(CAST_PERSONAS.get(gender, []))
    if persona and persona not in allowed:
        # Wrong-gender or unknown persona — drop; voice resolver will pick by age.
        persona = ""

    return {
        "gender": gender,
        "age_band": age_band,
        "presence": presence,
        "chirp_persona": persona,
        "rationale": rationale,
    }


def _persona_pool(gender: str, max_voices: int) -> list[str]:
    return list(CAST_PERSONAS.get(gender, [])[: max(1, max_voices)])


def _taken_personas(used: set[str]) -> set[str]:
    return {
        voice.rsplit("-", 1)[-1]
        for voice in used
        if voice.startswith("vi-VN-Chirp3-HD-") and "-" in voice
    }


def _stable_pick(personas: list[str], seed: str) -> str:
    if not personas:
        return ""
    key = normalize_lookup(seed) or seed or "x"
    return personas[sum(ord(ch) for ch in key) % len(personas)]


def choose_diversified_persona(
    *,
    gender: str,
    suggested: str,
    used: set[str],
    max_voices: int,
    name: str,
    age_band: str,
    presence: str,
) -> str:
    """Prefer AI suggestion when free; otherwise spread across unused personas.

    Demotes overused defaults (Charon/Orus) when other free voices remain.
    """
    pool = _persona_pool(gender, max_voices)
    if not pool:
        return suggested.strip()
    taken = _taken_personas(used)
    free = [persona for persona in pool if persona not in taken] or list(pool)
    bias = DEFAULT_PERSONA_BIAS.get(gender, set())
    free_non_bias = [persona for persona in free if persona not in bias]

    pick = (suggested or "").strip()
    allow_bias = (
        pick in bias
        and (
            (pick == "Charon" and age_band == "elder" and presence == "forceful")
            or (pick == "Orus" and age_band == "adult" and presence in {"neutral", "forceful"})
            or (pick == "Kore" and age_band == "elder")
            or (pick == "Aoede" and age_band == "adult")
        )
    )

    if pick in free:
        if pick not in bias or allow_bias or not free_non_bias:
            return pick
        # AI defaulted to Charon/Orus without a strong fit — spread instead.
        return _stable_pick(free_non_bias, name)

    if free_non_bias:
        return _stable_pick(free_non_bias, name)
    return _stable_pick(free, name)


def resolve_recommended_voice(
    *,
    engine: str,
    narrator_voice: str,
    gender: str,
    age_band: str,
    chirp_persona: str,
    used: set[str],
    max_voices: int,
    name: str = "",
    presence: str = "neutral",
) -> str:
    if engine == "chirp3":
        persona = choose_diversified_persona(
            gender=gender,
            suggested=chirp_persona,
            used=used,
            max_voices=max_voices,
            name=name,
            age_band=age_band,
            presence=presence,
        )
        if persona:
            return f"vi-VN-Chirp3-HD-{persona}"
    return assign_voice_for_profile(
        gender=gender,
        age_band=age_band,
        engine=engine,
        narrator_voice=narrator_voice,
        used=used,
        max_voices=max_voices,
    )


def _persona_menu_lines(max_voices: int) -> list[str]:
    lines: list[str] = []
    for gender in ("male", "female"):
        flavors = PERSONA_FLAVORS.get(gender, {})
        items = []
        for persona in _persona_pool(gender, max_voices):
            tip = flavors.get(persona, "")
            items.append(f"{persona} ({tip})" if tip else persona)
        lines.append(f"{gender}: " + "; ".join(items))
    return lines


async def recommend_cast_for_character(
    *,
    settings: Settings,
    name: str,
    aliases: list[str],
    summary: str,
    speaker_cue: str,
    dialogue_samples: list[str],
    engine: str,
    narrator_voice: str,
    used_voices: set[str],
    max_voices: int,
) -> dict[str, Any]:
    """Return gender/age/presence/voice recommendation. Never raises for model failure."""
    summary_text = (summary or "").strip()
    if len(summary_text) > MAX_SUMMARY_CHARS:
        summary_text = summary_text[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"
    display_name = name.strip() or speaker_cue.strip() or "Unknown"

    fallback, heuristic_why = explain_cast_inference(name, summary_text)
    fallback_voice = resolve_recommended_voice(
        engine=engine,
        narrator_voice=narrator_voice,
        gender=fallback["gender"],
        age_band=fallback["age_band"],
        chirp_persona="",
        used=used_voices,
        max_voices=max_voices,
        name=display_name,
        presence=fallback["presence"],
    )
    fallback_persona = (
        fallback_voice.rsplit("-", 1)[-1] if engine == "chirp3" else ""
    )
    voice_why = (
        f" Chọn giọng {fallback_persona} cho {fallback['gender']}/{fallback['age_band']}."
        if fallback_persona
        else f" Chọn giọng {fallback_voice}."
    )
    ai_off_note = (
        " (Gemini chưa bật trên server — đang dùng heuristic.)"
        if not gemini_available(settings)
        else ""
    )
    heuristic_payload = {
        **fallback,
        "tts_voice": fallback_voice,
        "chirp_persona": fallback_persona,
        "rationale": (heuristic_why + voice_why + ai_off_note).strip(),
        "source": "heuristic",
    }

    if not gemini_available(settings):
        return heuristic_payload

    taken = sorted(_taken_personas(used_voices))
    free_by_gender = {
        gender: [
            persona
            for persona in _persona_pool(gender, max_voices)
            if persona not in taken
        ]
        for gender in ("male", "female")
    }

    system = (
        "You assign Vietnamese audiobook TTS cast attributes for one character. "
        "Return JSON only with keys: gender, age_band, presence, chirp_persona, rationale. "
        "gender must be male or female. "
        "age_band must be youth, adult, or elder. "
        "presence must be soft, neutral, or forceful. "
        "chirp_persona must be chosen from the FREE personas for that gender. "
        "Cast diversity is critical: never reuse a taken persona. "
        "Do NOT default to Charon or Orus (male) or Kore/Aoede (female). "
        "Only pick those defaults when the character uniquely fits their flavor AND they are free. "
        "Prefer less-used / non-default personas when several could fit. "
        "Match persona flavor tags to the character, not only age. "
        "rationale must be 1-2 Vietnamese sentences explaining gender/age/presence and why that persona. "
        "Do not invent biography beyond the provided notes."
    )
    user_parts = [
        f"Name: {display_name}",
    ]
    if speaker_cue and speaker_cue.strip() != name.strip():
        user_parts.append(f"Screenplay cue: {speaker_cue.strip()}")
    if aliases:
        user_parts.append("Aliases: " + ", ".join(aliases[:12]))
    if summary_text:
        user_parts.append(f"Glossary notes:\n{summary_text}")
    if dialogue_samples:
        user_parts.append("Sample dialogue:\n- " + "\n- ".join(dialogue_samples))
    user_parts.append("Persona flavors:\n" + "\n".join(_persona_menu_lines(max_voices)))
    if taken:
        user_parts.append("Already taken (FORBIDDEN): " + ", ".join(taken))
    user_parts.append(
        "Free now — male: "
        + (", ".join(free_by_gender["male"]) or "(none)")
        + " | female: "
        + (", ".join(free_by_gender["female"]) or "(none)")
    )
    user_parts.append(
        "Attribute baseline only (ignore its implied voice): "
        f"gender={fallback['gender']}, age_band={fallback['age_band']}, "
        f"presence={fallback['presence']}"
    )
    user = "\n\n".join(user_parts)

    try:
        raw = await generate_gemini_text(
            settings=settings,
            system=system,
            user=user,
            temperature=0.55,
            max_output_tokens=260,
            timeout=25.0,
            response_mime_type="application/json",
        )
    except Exception:
        logger.exception("Gemini cast recommend failed for %s", name)
        return heuristic_payload

    parsed = parse_recommendation_payload(raw)
    if not parsed:
        heuristic_payload["rationale"] = "AI reply invalid; kept heuristic cast."
        return heuristic_payload

    voice = resolve_recommended_voice(
        engine=engine,
        narrator_voice=narrator_voice,
        gender=parsed["gender"],
        age_band=parsed["age_band"],
        chirp_persona=parsed["chirp_persona"],
        used=used_voices,
        max_voices=max_voices,
        name=display_name,
        presence=parsed["presence"],
    )
    persona = voice.rsplit("-", 1)[-1] if engine == "chirp3" else parsed["chirp_persona"]
    rationale = parsed["rationale"] or heuristic_why
    if persona and persona not in rationale:
        flavor = PERSONA_FLAVORS.get(parsed["gender"], {}).get(persona, "")
        extra = f" Persona {persona}" + (f" ({flavor})" if flavor else "") + "."
        rationale = f"{rationale}{extra}"
    if len(rationale) > MAX_RATIONALE_CHARS:
        rationale = rationale[: MAX_RATIONALE_CHARS - 1].rstrip() + "…"
    return {
        "gender": parsed["gender"],
        "age_band": parsed["age_band"],
        "presence": parsed["presence"],
        "tts_voice": voice,
        "chirp_persona": persona,
        "rationale": rationale,
        "source": "ai",
    }
