"""Publisher AI: suggest category slug + description blurb from manuscript sample."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Sequence

from .categories import CATEGORY_SEED
from .config import Settings
from .gemini import gemini_available, generate_gemini_text
from .segment_titles import SuggestLanguage, normalize_suggest_language, strip_code_fence

logger = logging.getLogger(__name__)

MAX_SAMPLE_CHARS = 8000
MAX_DESCRIPTION_CHARS = 400
MAX_BILINGUAL_DESCRIPTION_CHARS = MAX_DESCRIPTION_CHARS * 2
MAX_SEGMENT_NAME_CHARS = 48
VALID_SLUGS = {slug for slug, _label in CATEGORY_SEED}


def _description_language_rule(language: SuggestLanguage) -> str:
    if language == "vi":
        return (
            "Write the description in Vietnamese, 1-3 sentences, "
            f"under {MAX_DESCRIPTION_CHARS} characters."
        )
    if language == "bilingual":
        return (
            "Write a bilingual description: one English blurb (1-3 sentences) and one Vietnamese blurb "
            "with the same meaning, separated by a blank line. "
            f"Each language may use about {MAX_DESCRIPTION_CHARS} characters; "
            f"keep the whole description under {MAX_BILINGUAL_DESCRIPTION_CHARS} characters."
        )
    return (
        "Write the description in English, 1-3 sentences, "
        f"under {MAX_DESCRIPTION_CHARS} characters."
    )


def _clamp_description(description: str, language: SuggestLanguage) -> str:
    limit = (
        MAX_BILINGUAL_DESCRIPTION_CHARS
        if language == "bilingual"
        else MAX_DESCRIPTION_CHARS
    )
    if len(description) > limit:
        return description[: limit - 1].rstrip() + "…"
    return description


def manuscript_sample(title: str, raw_text: str, *, max_chars: int = MAX_SAMPLE_CHARS) -> str:
    text = (raw_text or "").strip()
    # Drop image URLs; keep captions so the model sees figure context as prose.
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > max_chars:
        cut = text[:max_chars]
        # Prefer truncating at a paragraph boundary when possible.
        boundary = max(cut.rfind("\n\n"), cut.rfind("\n"))
        if boundary > max_chars // 2:
            cut = cut[:boundary]
        text = cut.rstrip() + "…"
    title_line = (title or "").strip()
    if title_line:
        return f"Title: {title_line}\n\n{text}"
    return text


def parse_suggestion_payload(
    raw: str, *, language: SuggestLanguage = "en"
) -> dict[str, Any]:
    """Parse model JSON into category_slug + description with validation."""
    text = strip_code_fence(raw)
    data: Any
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Some models wrap JSON in prose; try the first {...} block.
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            return {"category_slug": "other", "description": ""}
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {"category_slug": "other", "description": ""}

    if not isinstance(data, dict):
        return {"category_slug": "other", "description": ""}

    slug = str(data.get("category_slug") or data.get("category") or "").strip().lower()
    if slug not in VALID_SLUGS:
        slug = "other"

    description = str(data.get("description") or "").strip()
    description = re.sub(r"[ \t]+", " ", description)
    description = re.sub(r"\n{3,}", "\n\n", description).strip()
    description = _clamp_description(description, language)

    return {"category_slug": slug, "description": description}


def _segment_name_language_rule(language: SuggestLanguage) -> str:
    if language == "vi":
        return "Write each name in Vietnamese."
    if language == "bilingual":
        return (
            "Write each name bilingual as 'English / Vietnamese' "
            "(same meaning, both short)."
        )
    return "Write each name in English."


def parse_segment_names_payload(raw: str, *, expected: int) -> list[str]:
    text = strip_code_fence(raw)
    data: Any
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}|\[.*\]", text, flags=re.DOTALL)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []

    names_raw: list[Any]
    if isinstance(data, dict):
        names_raw = data.get("names") if isinstance(data.get("names"), list) else []
    elif isinstance(data, list):
        names_raw = data
    else:
        names_raw = []

    names: list[str] = []
    for item in names_raw:
        name = re.sub(r"\s+", " ", str(item or "").strip())
        name = name.strip(" \"'`")
        if len(name) > MAX_SEGMENT_NAME_CHARS:
            name = name[: MAX_SEGMENT_NAME_CHARS - 1].rstrip() + "…"
        names.append(name)
    if len(names) < expected:
        names.extend([""] * (expected - len(names)))
    return names[:expected]


async def suggest_metadata(
    *,
    settings: Settings,
    title: str,
    raw_text: str,
    want_category: bool = True,
    want_description: bool = True,
    language: SuggestLanguage | str = "en",
) -> dict[str, Any]:
    if not gemini_available(settings):
        raise RuntimeError("ai_unavailable")

    lang = normalize_suggest_language(str(language))
    sample = manuscript_sample(title, raw_text)
    if not sample.strip():
        raise ValueError("no_text")

    slug_list = ", ".join(sorted(VALID_SLUGS))
    fields = []
    if want_category:
        fields.append("category_slug")
    if want_description:
        fields.append("description")
    if not fields:
        return {"category_slug": None, "description": None}

    system = (
        "You help indie authors catalog manuscripts on Read. "
        "Respond with JSON only — no markdown, no commentary. "
        "Pick exactly one category_slug from the allowed list. "
        f"{_description_language_rule(lang)} "
        "Describe the premise only; no spoilers beyond the opening setup; "
        "no bullet lists; no marketing hype."
    )
    user = (
        f"Allowed category_slug values: {slug_list}\n\n"
        f"Return JSON with keys: {', '.join(fields)}.\n\n"
        f"Manuscript sample:\n{sample}"
    )

    try:
        raw = await generate_gemini_text(
            settings=settings,
            system=system,
            user=user,
            temperature=0.3,
            max_output_tokens=700 if lang == "bilingual" else 500,
            timeout=45.0,
            response_mime_type="application/json",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Gemini publisher suggest failed")
        raise RuntimeError("ai_unavailable") from exc

    parsed = parse_suggestion_payload(raw or "", language=lang)
    result: dict[str, Any] = {
        "category_slug": parsed["category_slug"] if want_category else None,
        "description": parsed["description"] if want_description else None,
    }
    return result


async def suggest_segment_names(
    *,
    settings: Settings,
    book_title: str,
    segments: Sequence[dict[str, str]],
    language: SuggestLanguage | str = "en",
) -> list[str]:
    """Return short distinctive titles for packed reading segments."""
    if not segments:
        return []
    if not gemini_available(settings):
        raise RuntimeError("ai_unavailable")

    lang = normalize_suggest_language(str(language))
    samples = []
    for index, segment in enumerate(segments):
        sample = (segment.get("sample") or "").strip()
        if len(sample) > 900:
            sample = sample[:900].rstrip() + "…"
        samples.append(f"[{index + 1}]\n{sample or '(empty)'}")

    system = (
        "You name reading segments for an indie ebook app. "
        "Respond with JSON only — no markdown. "
        'Return {"names": ["...", ...]} with exactly one short distinctive title '
        "per segment, in the same order. "
        "Titles should be evocative of that segment's opening, not spoilers. "
        "No chapter numbers, no 'Part N', no book title repeated. "
        f"At most {MAX_SEGMENT_NAME_CHARS} characters each. "
        f"{_segment_name_language_rule(lang)}"
    )
    title_line = (book_title or "").strip() or "Untitled"
    user = (
        f"Book title: {title_line}\n"
        f"Segment count: {len(segments)}\n\n"
        "Segments:\n" + "\n\n".join(samples)
    )

    try:
        raw = await generate_gemini_text(
            settings=settings,
            system=system,
            user=user,
            temperature=0.4,
            max_output_tokens=min(120 + 40 * len(segments), 2048),
            timeout=60.0,
            response_mime_type="application/json",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Gemini segment naming failed")
        raise RuntimeError("ai_unavailable") from exc

    return parse_segment_names_payload(raw or "", expected=len(segments))

