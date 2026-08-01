"""Copy character cast assignments from one book (episode) to another.

Flexible series inheritance:
- Matching target characters (by name/alias) receive the source voice profile.
- Source characters missing on the target are carried forward as new glossary
  rows so later episodes stay covered even if they do not speak yet.
- Target ``cast_locked`` rows are left alone so local edits (ageing, etc.) win.
- Imported rows are locked against rebuild, but admins can still edit them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .cast_overrides import parse_cast_overrides
from .glossary import aliases_from_storage, aliases_to_storage, normalize_lookup


def _meta_from_mapping(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    voice = (raw.get("tts_voice") or "").strip()
    if not voice:
        return None
    gender = (raw.get("gender") or "").strip() or "male"
    if gender not in ("male", "female"):
        gender = "male"
    age_band = (raw.get("age_band") or "").strip() or "adult"
    if age_band not in ("youth", "adult", "elder"):
        age_band = "adult"
    presence = (raw.get("presence") or "").strip() or "neutral"
    if presence not in ("soft", "neutral", "forceful"):
        presence = "neutral"
    return {
        "gender": gender,
        "age_band": age_band,
        "presence": presence,
        "tts_voice": voice,
        "cast_locked": bool(raw.get("cast_locked")),
    }


def _prefer_meta(
    current: dict[str, Any] | None, candidate: dict[str, Any] | None
) -> dict[str, Any] | None:
    if candidate is None:
        return current
    if current is None:
        return dict(candidate)
    if bool(candidate.get("cast_locked")) and not bool(current.get("cast_locked")):
        return dict(candidate)
    return current


def _entry_keys(entry) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    name = getattr(entry, "name", "") or ""
    aliases_raw = getattr(entry, "aliases", None)
    aliases = (
        aliases_from_storage(aliases_raw)
        if isinstance(aliases_raw, str)
        else list(aliases_raw or [])
    )
    for candidate in [name, *aliases]:
        key = normalize_lookup(str(candidate or ""))
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys


def _normalize_overrides(
    overrides_raw: str | dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    if isinstance(overrides_raw, dict):
        cleaned: dict[str, dict[str, Any]] = {}
        for key, meta in overrides_raw.items():
            if not isinstance(meta, dict):
                continue
            normalized = normalize_lookup(str(key))
            if not normalized:
                continue
            parsed = _meta_from_mapping(meta)
            if parsed:
                cleaned[normalized] = parsed
        return cleaned
    return {
        key: parsed
        for key, meta in parse_cast_overrides(
            overrides_raw if isinstance(overrides_raw, str) else None
        ).items()
        if (parsed := _meta_from_mapping(meta)) is not None
    }


def build_source_cast_lookup(
    entries: list,
    overrides_raw: str | dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    """Map every source name/alias/override key → cast meta."""
    overrides = _normalize_overrides(overrides_raw)
    lookup: dict[str, dict[str, Any]] = {}

    for entry in entries:
        keys = _entry_keys(entry)
        if not keys:
            continue
        row_meta = _meta_from_mapping(
            {
                "gender": getattr(entry, "gender", None),
                "age_band": getattr(entry, "age_band", None),
                "presence": getattr(entry, "presence", None),
                "tts_voice": getattr(entry, "tts_voice", None),
                "cast_locked": getattr(entry, "cast_locked", False),
            }
        )
        for key in keys:
            override_meta = overrides.get(key)
            if override_meta and bool(override_meta.get("cast_locked")):
                chosen = override_meta
            elif row_meta and bool(row_meta.get("cast_locked")):
                chosen = row_meta
            else:
                chosen = _prefer_meta(row_meta, override_meta)
            if chosen:
                lookup[key] = _prefer_meta(lookup.get(key), chosen) or chosen

    for key, meta in overrides.items():
        lookup[key] = _prefer_meta(lookup.get(key), meta) or meta

    return lookup


def resolve_source_meta(
    lookup: dict[str, dict[str, Any]], keys: list[str]
) -> dict[str, Any] | None:
    """Best source meta among candidate keys; locked wins."""
    best: dict[str, Any] | None = None
    for key in keys:
        candidate = lookup.get(key)
        if candidate:
            best = _prefer_meta(best, candidate)
    return dict(best) if best else None


def _group_by_name(entries: list) -> tuple[dict[str, list], dict[str, list[str]], dict[str, Any]]:
    groups: dict[str, list] = {}
    group_keys: dict[str, list[str]] = {}
    canonical: dict[str, Any] = {}
    for entry in entries:
        name_key = normalize_lookup(getattr(entry, "name", "") or "")
        if not name_key:
            continue
        groups.setdefault(name_key, []).append(entry)
        if name_key not in group_keys:
            group_keys[name_key] = _entry_keys(entry)
            canonical[name_key] = entry
    return groups, group_keys, canonical


def _target_occupied_keys(target_entries: list) -> set[str]:
    occupied: set[str] = set()
    for entry in target_entries:
        for key in _entry_keys(entry):
            occupied.add(key)
    return occupied


def _cast_meta_for_apply(
    source_meta: dict[str, Any], *, lock_imported: bool
) -> dict[str, Any]:
    return {
        "gender": source_meta["gender"],
        "age_band": source_meta["age_band"],
        "presence": source_meta["presence"],
        "tts_voice": source_meta["tts_voice"],
        "cast_locked": True if lock_imported else bool(source_meta.get("cast_locked")),
    }


def _apply_meta_to_rows(
    rows: list,
    meta: dict[str, Any],
    *,
    keys: list[str],
    target_overrides: dict[str, Any],
    stamp: datetime,
) -> int:
    updated = 0
    for row in rows:
        row.gender = meta["gender"]
        row.age_band = meta["age_band"]
        row.presence = meta["presence"]
        row.tts_voice = meta["tts_voice"]
        row.cast_locked = bool(meta["cast_locked"])
        row.updated_at = stamp
        updated += 1
    for key in keys:
        existing = target_overrides.get(key)
        if isinstance(existing, dict) and bool(existing.get("cast_locked")):
            continue
        target_overrides[key] = dict(meta)
    return updated


def _carry_forward_spec(
    source_entry,
    meta: dict[str, Any],
    *,
    episode_key: str = "",
    episode_title: str = "",
) -> dict[str, Any]:
    aliases_raw = getattr(source_entry, "aliases", None)
    if isinstance(aliases_raw, str):
        aliases = aliases_from_storage(aliases_raw)
        aliases_storage = aliases_raw if aliases_raw.strip() else "[]"
    else:
        aliases = list(aliases_raw or [])
        aliases_storage = aliases_to_storage(aliases)
    name = (getattr(source_entry, "name", "") or "").strip()
    return {
        "name": name,
        "aliases": aliases_storage,
        "summary": (getattr(source_entry, "summary", "") or "").strip(),
        "group_label": (getattr(source_entry, "group_label", "") or "").strip() or "Nhân vật",
        "episode_key": episode_key,
        "episode_title": episode_title,
        "sort_key": normalize_lookup(name),
        "gender": meta["gender"],
        "age_band": meta["age_band"],
        "presence": meta["presence"],
        "tts_voice": meta["tts_voice"],
        "cast_locked": bool(meta["cast_locked"]),
        "lookup_keys": _entry_keys(source_entry),
    }


def import_cast_from_source(
    *,
    target_entries: list,
    target_overrides: dict[str, Any],
    source_entries: list,
    source_overrides_raw: str | dict[str, Any] | None,
    lock_imported: bool = True,
    carry_forward: bool = True,
    episode_key: str = "",
    episode_title: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Apply source cast onto matching target rows; optionally carry forward missing.

    Returns counts plus ``carry_forward`` specs for new glossary rows the caller
    should insert. Mutates ``target_entries`` and ``target_overrides`` in place.
    """
    lookup = build_source_cast_lookup(source_entries, source_overrides_raw)
    stamp = now or datetime.now(timezone.utc)
    target_groups, target_keys, _target_canonical = _group_by_name(target_entries)
    source_groups, source_keys, source_canonical = _group_by_name(source_entries)
    occupied = _target_occupied_keys(target_entries)

    updated = 0
    skipped_locked = 0
    matched = 0
    unmatched = 0
    carry_specs: list[dict[str, Any]] = []

    for name_key, rows in target_groups.items():
        keys = target_keys[name_key]
        source_meta = resolve_source_meta(lookup, keys)
        if source_meta is None:
            unmatched += 1
            continue
        matched += 1

        if any(bool(getattr(row, "cast_locked", False)) for row in rows):
            skipped_locked += 1
            continue

        meta = _cast_meta_for_apply(source_meta, lock_imported=lock_imported)
        updated += _apply_meta_to_rows(
            rows,
            meta,
            keys=keys,
            target_overrides=target_overrides,
            stamp=stamp,
        )

    if carry_forward:
        for name_key, keys in source_keys.items():
            if any(key in occupied for key in keys):
                continue
            source_meta = resolve_source_meta(lookup, keys)
            if source_meta is None:
                continue
            meta = _cast_meta_for_apply(source_meta, lock_imported=lock_imported)
            spec = _carry_forward_spec(
                source_canonical[name_key],
                meta,
                episode_key=episode_key,
                episode_title=episode_title,
            )
            carry_specs.append(spec)
            for key in spec["lookup_keys"]:
                occupied.add(key)
                existing = target_overrides.get(key)
                if isinstance(existing, dict) and bool(existing.get("cast_locked")):
                    continue
                target_overrides[key] = dict(meta)

    return {
        "updated": updated,
        "skipped_locked": skipped_locked,
        "matched": matched,
        "unmatched": unmatched,
        "carried": len(carry_specs),
        "carry_forward": carry_specs,
    }
