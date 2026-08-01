"""Canonical cast-override keys and effective synth voice resolution.

All persisted override keys must be ``normalize_lookup`` results (ASCII-folded,
``đ→d``). Dirty legacy keys are merged on read/write so synthesis never sees
two spellings of the same speaker.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .glossary import normalize_lookup

logger = logging.getLogger(__name__)


def is_canonical_lookup_key(value: str) -> bool:
    text = (value or "").strip()
    return bool(text) and text == normalize_lookup(text)


def parse_cast_overrides(raw: str | None) -> dict[str, dict[str, Any]]:
    """Parse and canonicalize override JSON. Locked metas win on key collision."""
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}

    cleaned: dict[str, dict[str, Any]] = {}
    for key, meta in data.items():
        if not isinstance(meta, dict):
            continue
        normalized = normalize_lookup(str(key))
        if not normalized:
            continue
        prev = cleaned.get(normalized)
        if prev and bool(prev.get("cast_locked")) and not bool(meta.get("cast_locked")):
            if str(key) != normalized:
                logger.info(
                    "Dropped dirty cast override key %r in favor of locked %r",
                    key,
                    normalized,
                )
            continue
        if prev is not None and str(key) != normalized:
            logger.info(
                "Merged dirty cast override key %r into canonical %r",
                key,
                normalized,
            )
        cleaned[normalized] = dict(meta)
    return cleaned


def serialize_cast_overrides(overrides: dict[str, Any] | None) -> str:
    out: dict[str, dict[str, Any]] = {}
    if isinstance(overrides, dict):
        for key, meta in overrides.items():
            if not isinstance(meta, dict):
                continue
            normalized = normalize_lookup(str(key))
            if not normalized:
                continue
            prev = out.get(normalized)
            if prev and bool(prev.get("cast_locked")) and not bool(meta.get("cast_locked")):
                continue
            out[normalized] = dict(meta)
    return json.dumps(out, ensure_ascii=False)


def overrides_raw_needs_rewrite(raw: str | None) -> bool:
    """True when stored JSON contains non-canonical keys or non-object metas."""
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return True
    if not isinstance(data, dict):
        return True
    for key, meta in data.items():
        if not isinstance(meta, dict):
            return True
        if str(key) != normalize_lookup(str(key)):
            return True
    return False


def apply_overrides_to_cast_maps(
    voices: dict[str, str],
    presence: dict[str, str],
    *,
    entries: list,
    overrides: dict[str, dict[str, Any]],
) -> tuple[dict[str, str], dict[str, str]]:
    """Merge glossary rows + overrides into synth lookup maps (canonical keys)."""
    next_voices = dict(voices)
    next_presence = dict(presence)

    locked_keys: set[str] = set()
    for entry in entries:
        key = normalize_lookup(getattr(entry, "name", "") or "")
        if not key:
            continue
        if bool(getattr(entry, "cast_locked", False)):
            locked_keys.add(key)
            voice = (getattr(entry, "tts_voice", "") or "").strip()
            if voice:
                next_voices[key] = voice
            value = (getattr(entry, "presence", "") or "").strip()
            if value:
                next_presence[key] = value

    for key, meta in (overrides or {}).items():
        if not isinstance(meta, dict):
            continue
        normalized = normalize_lookup(str(key))
        if not normalized:
            continue
        override_locked = bool(meta.get("cast_locked"))
        if normalized in locked_keys and not override_locked:
            continue
        voice = (meta.get("tts_voice") or "").strip()
        if voice:
            next_voices[normalized] = voice
        value = (meta.get("presence") or "").strip()
        if value:
            next_presence[normalized] = value

    return next_voices, next_presence


def duplicate_voice_warnings(
    labels_by_key: dict[str, str],
    voices_by_key: dict[str, str],
) -> list[str]:
    """Warn when two distinct speakers share the same TTS voice."""
    by_voice: dict[str, list[str]] = {}
    for key, voice in voices_by_key.items():
        cleaned = (voice or "").strip()
        if not cleaned:
            continue
        label = (labels_by_key.get(key) or key).strip() or key
        by_voice.setdefault(cleaned, []).append(label)

    warnings: list[str] = []
    for voice, names in sorted(by_voice.items(), key=lambda item: item[0]):
        unique = list(dict.fromkeys(names))
        if len(unique) < 2:
            continue
        persona = voice.rsplit("-", 1)[-1]
        shown = ", ".join(unique[:4])
        extra = f" (+{len(unique) - 4} more)" if len(unique) > 4 else ""
        warnings.append(
            f"Same voice {persona} assigned to {shown}{extra}."
        )
    return warnings
