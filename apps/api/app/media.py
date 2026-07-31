"""Inline manuscript media (figures) — normalize, store, and URL helpers."""

from __future__ import annotations

import hashlib
import io
import logging
import shutil
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

MAX_LONG_EDGE = 1600
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
JPEG_QUALITY = 85
# Solid-color PNGs compress tiny; gate on pixel size instead of a high byte floor.
MIN_BYTES = 64
MIN_EDGE = 40
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def media_dir(upload_dir: str | Path, book_id: str) -> Path:
    return Path(upload_dir) / "media" / book_id


def media_relative_path(book_id: str, asset_id: str) -> str:
    return f"media/{book_id}/{asset_id}.jpg"


def media_absolute_path(upload_dir: str | Path, book_id: str, asset_id: str) -> Path:
    return Path(upload_dir) / media_relative_path(book_id, asset_id)


def media_url_for(book_id: str, asset_id: str) -> str:
    return f"/api/books/{book_id}/media/{asset_id}.jpg"


def clear_book_media(upload_dir: str | Path, book_id: str) -> None:
    path = media_dir(upload_dir, book_id)
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)


def qualifies_as_inline_media(raw: bytes) -> bool:
    if len(raw) < MIN_BYTES:
        return False
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:  # noqa: BLE001
        return False
    width, height = image.size
    return min(width, height) >= MIN_EDGE


def normalize_media_image(raw: bytes) -> bytes:
    """Decode a raster image and re-encode as JPEG under size caps (no crop)."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Image is too large.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Could not read image.") from exc

    if image.mode not in {"RGB", "L"}:
        image = image.convert("RGB")
    elif image.mode == "L":
        image = image.convert("RGB")

    width, height = image.size
    long_edge = max(width, height)
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / long_edge
        image = image.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()


def save_media_bytes(upload_dir: str | Path, book_id: str, raw: bytes) -> str:
    """Persist an inline figure; return asset id (stable hash of normalized bytes)."""
    normalized = normalize_media_image(raw)
    asset_id = hashlib.sha1(normalized).hexdigest()[:16]
    path = media_absolute_path(upload_dir, book_id, asset_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        path.write_bytes(normalized)
    return asset_id


def is_jpeg_or_png(content_type: str | None, filename: str | None) -> bool:
    ctype = (content_type or "").split(";")[0].strip().lower()
    ext = Path(filename or "").suffix.lower()
    if ctype in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        return True
    return ext in ALLOWED_EXT
