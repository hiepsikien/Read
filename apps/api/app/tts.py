import hashlib
import html
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from google.cloud import texttospeech

from .config import Settings

MAX_TTS_INPUT_BYTES = 4500
TTS_CACHE_VERSION = "v2"

# Default Vietnamese voices per engine × gender.
# Chirp3 has many personas; defaults are Charon (male) and Kore (female).
# Override Chirp persona via Settings.google_tts_chirp_persona.
VOICE_CATALOG: dict[str, dict[str, str]] = {
    "standard": {
        "female": "vi-VN-Standard-A",
        "male": "vi-VN-Standard-D",
    },
    "wavenet": {
        "female": "vi-VN-Wavenet-A",
        "male": "vi-VN-Wavenet-D",
    },
    "neural2": {
        "female": "vi-VN-Neural2-A",
        "male": "vi-VN-Neural2-D",
    },
    "chirp3": {
        "female": "vi-VN-Chirp3-HD-Kore",
        "male": "vi-VN-Chirp3-HD-Charon",
    },
}

ENGINE_LABELS = {
    "standard": "Google Standard",
    "wavenet": "Google WaveNet",
    "neural2": "Google Neural2",
    "chirp3": "Google Chirp3 HD",
}

CHIRP3_PERSONAS = {
    "female": [
        "Achernar",
        "Aoede",
        "Autonoe",
        "Callirrhoe",
        "Despina",
        "Erinome",
        "Gacrux",
        "Kore",
        "Laomedeia",
        "Leda",
        "Pulcherrima",
        "Sulafat",
        "Vindemiatrix",
        "Zephyr",
    ],
    "male": [
        "Achird",
        "Algenib",
        "Algieba",
        "Alnilam",
        "Charon",
        "Enceladus",
        "Fenrir",
        "Iapetus",
        "Orus",
        "Puck",
        "Rasalgethi",
        "Sadachbia",
        "Sadaltager",
        "Schedar",
        "Umbriel",
        "Zubenelgenubi",
    ],
}

_cache_locks: dict[str, threading.Lock] = {}
_cache_locks_guard = threading.Lock()

# A screenplay dialogue line exported from DOCX looks like:
#   COLUMBUS *(Giọng khàn đặc)* Nhân danh Chúa...
# An optional role may sit between the speaker and direction:
#   NGƯỜI THƯ KÝ (Hộ tống) *(Thì thầm)* Thưa thuyền trưởng...
#
# Requiring the direction to be italic keeps ordinary prose such as
# "AFONSO (58 tuổi) đứng trên boong..." out of this transformation.
_SCREENPLAY_DIALOGUE_RE = re.compile(
    r"^(?P<speaker>[^*()\n]{2,80}?)"
    r"(?:\s+\((?P<role>[^)]*)\))?"
    r"\s+\*{1,3}\((?P<direction>[^)]*)\)\*{1,3}"
    r"\s+(?P<dialogue>.+)$"
)
_LEADING_STAGE_DIRECTION_RE = re.compile(
    r"^\*{1,3}\((?P<direction>[^)]*)\)\*{1,3}\s+(?P<dialogue>.+)$"
)
_NON_SPEAKER_CUES = {
    "BÃI",
    "BỜ",
    "CẢNH",
    "CẬN",
    "CHUYỂN",
    "CẮT",
    "DÒNG",
    "ĐIỆN",
    "DINH",
    "DOANH",
    "EO",
    "HẾT",
    "HÌNH",
    "KHÁM",
    "LỆNH",
    "MÀN",
    "MẬT",
    "SOÁI",
    "TRẬN",
    "TRÊN",
    "TRUNG",
    "XƯỞNG",
}

# The DOCX source writes headings and character names in caps, and Google TTS
# reads an all-caps token as an initialism: CALICUT becomes "C-A-L-I-C-U-T"
# while the same word in prose reads correctly. Title casing restores word
# pronunciation without changing Vietnamese phonetics.
#
# Two groups must stay uppercase. Real initialisms are meant to be spelled out,
# and roman numerals read as numbers. The numeral set deliberately omits forms
# that collide with Vietnamese words -- DI ("di dân"), VI ("ngoại vi"), and the
# single letters -- because those appear far more often as words than as digits.
_SPELLED_ACRONYMS = {"BBC", "CIA", "EIC", "GDP", "USD", "VOC"}
_ROMAN_NUMERALS = {
    "II",
    "III",
    "IV",
    "VII",
    "VIII",
    "IX",
    "XI",
    "XII",
    "XIII",
    "XIV",
    "XV",
    "XVI",
    "XVII",
    "XVIII",
    "XIX",
    "XX",
}
_WORD_RE = re.compile(r"[^\W\d_]+(?:['’\-][^\W\d_]+)*")


@dataclass(frozen=True)
class AudioSegment:
    index: int
    paragraph_index: int
    text: str
    cache_key: str
    is_ssml: bool = False


def normalize_engine(value: str) -> str:
    engine = value.strip().lower().replace(" ", "").replace("-", "").replace("_", "")
    aliases = {
        "standard": "standard",
        "wavenet": "wavenet",
        "wave": "wavenet",
        "neural2": "neural2",
        "neural": "neural2",
        "chirp3": "chirp3",
        "chirp": "chirp3",
        "chirp3hd": "chirp3",
    }
    if engine not in aliases:
        raise ValueError(
            f"Unknown TTS engine {value!r}. Use: standard, wavenet, neural2, chirp3."
        )
    return aliases[engine]


def normalize_gender(value: str) -> str:
    gender = value.strip().lower()
    if gender in {"m", "male", "nam"}:
        return "male"
    if gender in {"f", "female", "nu", "nữ"}:
        return "female"
    raise ValueError(f"Unknown TTS gender {value!r}. Use: male, female.")


def resolve_voice(
    engine: str,
    gender: str,
    *,
    chirp_persona: str = "",
    voice_override: str = "",
) -> str:
    override = voice_override.strip()
    if override:
        return override

    engine_key = normalize_engine(engine)
    gender_key = normalize_gender(gender)
    persona = chirp_persona.strip()
    if engine_key == "chirp3" and persona:
        return f"vi-VN-Chirp3-HD-{persona}"
    return VOICE_CATALOG[engine_key][gender_key]


def voice_options() -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    for engine, genders in VOICE_CATALOG.items():
        for gender, voice in genders.items():
            options.append(
                {
                    "engine": engine,
                    "engine_label": ENGINE_LABELS[engine],
                    "gender": gender,
                    "voice": voice,
                }
            )
    return options


def _is_character_cue(value: str) -> bool:
    letters = [character for character in value if character.isalpha()]
    return bool(letters) and value == value.upper() and len(value.split()) <= 8


def _screenplay_match(value: str) -> re.Match[str] | None:
    match = _SCREENPLAY_DIALOGUE_RE.match(value.strip())
    if match and _is_character_cue(match.group("speaker").strip()):
        return match
    return None


def _plain_screenplay_dialogue(value: str) -> tuple[str, str] | None:
    """Recognize `ALL CAPS SPEAKER Dialogue` without a stage direction."""
    value = value.strip()
    if not value or value == value.upper() or value.startswith(("*", "“", '"')):
        return None

    tokens = value.split()
    cue_tokens: list[str] = []
    for token in tokens:
        cleaned = token.strip(".,!?;:–—-")
        if cleaned and any(character.isalpha() for character in cleaned) and cleaned == cleaned.upper():
            cue_tokens.append(token)
            continue
        break

    if not cue_tokens or len(cue_tokens) > 8:
        return None
    speaker = " ".join(cue_tokens).strip(" .,:;–—-")
    if not _is_character_cue(speaker) or ":" in " ".join(cue_tokens):
        return None
    if cue_tokens[0].strip(".,!?;:–—-") in _NON_SPEAKER_CUES:
        return None

    dialogue = " ".join(tokens[len(cue_tokens) :]).strip()
    # `(51 tuổi) bước...` is a prose character introduction. A lowercase
    # continuation such as `và toán thủy thủ...` is narrative, not dialogue.
    visible = dialogue.lstrip("….-–—“”\"' ")
    if not visible or visible.startswith("(") or not visible[0].isupper():
        return None
    return speaker, dialogue


def _screenplay_text_for_speech(value: str) -> str:
    match = _screenplay_match(value)
    if match:
        # Title case makes names such as COLUMBUS look like words rather than
        # acronyms, reducing letter-by-letter pronunciation on some voices.
        speaker = match.group("speaker").strip().title()
        role = (match.group("role") or "").strip()
        direction = match.group("direction").strip()
        dialogue = match.group("dialogue").strip()
        parts = [speaker, role, direction, dialogue]
        return " ".join(_as_sentence(part) for part in parts if part)

    plain_dialogue = _plain_screenplay_dialogue(value)
    if plain_dialogue:
        speaker, dialogue = plain_dialogue
        return f"{_as_sentence(speaker.title())} {dialogue}"

    # Preserve a leading direction but make its boundary explicit. A standalone
    # italic paragraph remains untouched because it may carry a time jump.
    direction = _LEADING_STAGE_DIRECTION_RE.match(value.strip())
    if direction:
        raw_direction = direction.group("direction").strip()
        dialogue = direction.group("dialogue").strip()
        return f"{_as_sentence(raw_direction)} {dialogue}"
    return value


def _as_sentence(value: str) -> str:
    value = value.strip()
    return value if not value or value[-1] in ".!?…" else f"{value}."


def _soften_all_caps(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        word = match.group(0)
        if len(word) < 2 or word == word.lower() or word != word.upper():
            return word
        if word in _SPELLED_ACRONYMS or word in _ROMAN_NUMERALS:
            return word
        return word.title()

    return _WORD_RE.sub(replace, value)


def _sanitize_speech_markup(value: str) -> str:
    value = html.unescape(value)
    # Skip figures entirely — do not narrate image captions.
    value = re.sub(r"!\[([^\]]*)\]\([^)]+\)", "", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(
        r"https?://\S+|www\.\S+",
        lambda match: match.group(0)[-1] if match.group(0)[-1] in ".,;:!?" else "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"\[(?:\d+(?:\s*[,–-]\s*\d+)*)\]", "", value)
    value = re.sub(r"\((?:\d+(?:\s*[,–-]\s*\d+)*)\)", "", value)
    value = re.sub(r"^\s*(?:[-*+•]|\d+[.)]|[a-zA-Z][.)])\s+", "", value)
    value = re.sub(r"(\*{1,3}|_{1,3})(.*?)\1", r"\2", value)
    value = re.sub(r"[`#>~]", "", value)
    value = _soften_all_caps(value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    value = re.sub(r"([,;:!?])\1+", r"\1", value)
    value = re.sub(r"\.{4,}", "...", value)
    return value.strip()


def normalize_for_speech(value: str) -> str:
    return _sanitize_speech_markup(_screenplay_text_for_speech(value))


def _dialogue_prosody(direction: str) -> tuple[int, int, int]:
    """Return rate percent, pitch semitones, and volume dB from a stage cue."""
    cue = direction.casefold()
    rate = 100
    pitch = 0
    volume = 0

    if re.search(r"trầm|khàn|lạnh lùng|uy nghiêm|trang trọng|vững chãi", cue):
        rate = 94
        pitch = -2
    if re.search(r"thì thầm|thoại thầm|nói nhỏ|nói khẽ|lẩm bẩm|nội tâm|nghĩ trong đầu", cue):
        rate = 88
        pitch = min(pitch, -2)
        volume = -4
    if re.search(r"hét|gào|thét|kêu xé|vang dội|nói lớn", cue):
        rate = max(rate, 103)
        volume = 2
    if re.search(r"run|sợ hãi|kinh hoàng|hoảng|lạc đi", cue):
        rate = max(rate, 105)
        pitch = max(pitch, 1)
    if re.search(r"tức giận|giận dữ|răn đe|đe dọa", cue):
        rate = max(rate, 104)
        volume = max(volume, 1)
    return rate, pitch, volume


def _ssml_text(value: str) -> str:
    return html.escape(value, quote=False)


def _prosody_ssml(value: str, *, rate: int, pitch: int, volume: int) -> str:
    return (
        f'<prosody rate="{rate}%" pitch="{pitch:+d}st" '
        f'volume="{volume:+d}dB">{_ssml_text(value)}</prosody>'
    )


def _screenplay_ssml_chunks(
    paragraph: str,
    max_bytes: int = MAX_TTS_INPUT_BYTES,
) -> list[str] | None:
    match = _screenplay_match(paragraph)
    plain_dialogue = _plain_screenplay_dialogue(paragraph)
    leading_direction = _LEADING_STAGE_DIRECTION_RE.match(paragraph.strip())
    if not match and not plain_dialogue and not leading_direction:
        return None

    if match:
        speaker = _sanitize_speech_markup(match.group("speaker").strip().title())
        role = _sanitize_speech_markup((match.group("role") or "").strip())
        direction = _sanitize_speech_markup(match.group("direction").strip())
        dialogue = _sanitize_speech_markup(match.group("dialogue").strip())
    elif plain_dialogue:
        raw_speaker, raw_dialogue = plain_dialogue
        speaker = _sanitize_speech_markup(raw_speaker.title())
        role = ""
        direction = ""
        dialogue = _sanitize_speech_markup(raw_dialogue)
    else:
        speaker = ""
        role = ""
        direction = _sanitize_speech_markup(leading_direction.group("direction").strip())
        dialogue = _sanitize_speech_markup(leading_direction.group("dialogue").strip())

    if not dialogue:
        return None

    # Leave room for the SSML envelope. Long dialogue is split, but the
    # speaker/direction cue is spoken only before the first chunk.
    dialogue_chunks = _chunks_within_limit(dialogue, max_bytes=max(1000, max_bytes - 900))
    rate, pitch, volume = _dialogue_prosody(direction)
    rendered: list[str] = []
    for index, chunk in enumerate(dialogue_chunks):
        parts = ["<speak>"]
        if index == 0:
            if speaker:
                parts.append(f"<s>{_ssml_text(_as_sentence(speaker))}</s>")
                parts.append('<break time="300ms"/>')
            if role:
                parts.append(
                    _prosody_ssml(
                        _as_sentence(role),
                        rate=90,
                        pitch=-1,
                        volume=-2,
                    )
                )
                parts.append('<break time="250ms"/>')
            if direction:
                parts.append(
                    _prosody_ssml(
                        _as_sentence(direction),
                        rate=90,
                        pitch=-1,
                        volume=-2,
                    )
                )
                parts.append('<break time="450ms"/>')
        parts.append(
            _prosody_ssml(
                chunk,
                rate=rate,
                pitch=pitch,
                volume=volume,
            )
        )
        parts.append("</speak>")
        ssml = "".join(parts)
        if len(ssml.encode("utf-8")) > max_bytes:
            # Extremely long speaker/direction cues are safer as plain speech
            # than an invalid over-limit request.
            return None
        rendered.append(ssml)
    return rendered


def _chunks_within_limit(value: str, max_bytes: int = MAX_TTS_INPUT_BYTES) -> list[str]:
    if len(value.encode("utf-8")) <= max_bytes:
        return [value]

    sentences = re.split(r"(?<=[.!?…])\s+", value)
    chunks: list[str] = []
    current = ""

    def push(piece: str) -> None:
        nonlocal current
        candidate = f"{current} {piece}".strip()
        if len(candidate.encode("utf-8")) <= max_bytes:
            current = candidate
            return
        if current:
            chunks.append(current)
            current = ""
        if len(piece.encode("utf-8")) <= max_bytes:
            current = piece
            return

        words = piece.split()
        word_chunk = ""
        for word in words:
            candidate_word_chunk = f"{word_chunk} {word}".strip()
            if len(candidate_word_chunk.encode("utf-8")) <= max_bytes:
                word_chunk = candidate_word_chunk
                continue
            if word_chunk:
                chunks.append(word_chunk)
            if len(word.encode("utf-8")) <= max_bytes:
                word_chunk = word
                continue

            character_chunk = ""
            for character in word:
                if len((character_chunk + character).encode("utf-8")) > max_bytes:
                    chunks.append(character_chunk)
                    character_chunk = character
                else:
                    character_chunk += character
            word_chunk = character_chunk
        current = word_chunk

    for sentence in sentences:
        if sentence.strip():
            push(sentence.strip())
    if current:
        chunks.append(current)
    return chunks


def chapter_audio_segments(content: str, voice: str) -> list[AudioSegment]:
    paragraphs = [
        collapsed
        for paragraph in re.split(r"\n\s*\n", content)
        if (collapsed := re.sub(r"\s*\n\s*", " ", paragraph).strip())
    ]
    segments: list[AudioSegment] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        screenplay_chunks = _screenplay_ssml_chunks(paragraph)
        if screenplay_chunks:
            for chunk in screenplay_chunks:
                digest = hashlib.sha256(
                    f"{TTS_CACHE_VERSION}\0{voice}\0ssml\0{chunk}".encode()
                ).hexdigest()
                segments.append(
                    AudioSegment(
                        index=len(segments),
                        paragraph_index=paragraph_index,
                        text=chunk,
                        cache_key=digest,
                        is_ssml=True,
                    )
                )
            continue

        normalized = normalize_for_speech(paragraph)
        if not normalized:
            continue
        for chunk in _chunks_within_limit(normalized):
            digest = hashlib.sha256(
                f"{TTS_CACHE_VERSION}\0{voice}\0{chunk}".encode()
            ).hexdigest()
            segments.append(
                AudioSegment(
                    index=len(segments),
                    paragraph_index=paragraph_index,
                    text=chunk,
                    cache_key=digest,
                    is_ssml=False,
                )
            )
    return segments


def cache_path(settings: Settings, segment: AudioSegment) -> Path:
    root = Path(settings.resolved_tts_cache_dir)
    return root / segment.cache_key[:2] / f"{segment.cache_key}.mp3"


def _lock_for(cache_key: str) -> threading.Lock:
    with _cache_locks_guard:
        return _cache_locks.setdefault(cache_key, threading.Lock())


@lru_cache(maxsize=1)
def _client() -> texttospeech.TextToSpeechClient:
    return texttospeech.TextToSpeechClient()


def synthesize_text(voice: str, text: str, *, is_ssml: bool = False) -> bytes:
    language_code = "-".join(voice.split("-")[:2])
    response = _client().synthesize_speech(
        input=(
            texttospeech.SynthesisInput(ssml=text)
            if is_ssml
            else texttospeech.SynthesisInput(text=text)
        ),
        voice=texttospeech.VoiceSelectionParams(
            language_code=language_code,
            name=voice,
        ),
        audio_config=texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=1.0,
        ),
    )
    return response.audio_content


def synthesize_segment(settings: Settings, segment: AudioSegment, voice: str) -> Path:
    path = cache_path(settings, segment)
    if path.is_file():
        return path

    with _lock_for(segment.cache_key):
        if path.is_file():
            return path

        audio_content = synthesize_text(voice, segment.text, is_ssml=segment.is_ssml)

        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            temporary_path.write_bytes(audio_content)
            os.replace(temporary_path, path)
        finally:
            temporary_path.unlink(missing_ok=True)
        return path


def prepare_segments(settings: Settings, segments: list[AudioSegment], voice: str) -> None:
    missing = [segment for segment in segments if not cache_path(settings, segment).is_file()]
    if not missing:
        return
    with ThreadPoolExecutor(max_workers=min(4, len(missing))) as executor:
        list(
            executor.map(
                lambda segment: synthesize_segment(settings, segment, voice),
                missing,
            )
        )