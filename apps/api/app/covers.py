"""Book cover extraction, normalization, and storage helpers."""

from __future__ import annotations

import io
import logging
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from PIL import Image

logger = logging.getLogger(__name__)

MIN_BYTES = 80 * 1024
MIN_SHORT_EDGE = 400
MIN_LONG_EDGE = 600
MAX_LONG_EDGE = 1600
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
JPEG_QUALITY = 85
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def cover_relative_path(book_id: str) -> str:
    return f"covers/{book_id}.jpg"


def cover_absolute_path(upload_dir: str | Path, book_id: str) -> Path:
    return Path(upload_dir) / cover_relative_path(book_id)


def cover_url_for(book_id: str, cover_path: str | None) -> str | None:
    if not cover_path:
        return None
    return f"/api/books/{book_id}/cover"


def normalize_cover_image(raw: bytes) -> bytes:
    """Decode any supported raster image and re-encode as JPEG under size caps."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Cover image is too large. Max 5MB.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Could not read cover image.") from exc

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


def save_cover_bytes(upload_dir: str | Path, book_id: str, raw: bytes) -> str:
    normalized = normalize_cover_image(raw)
    path = cover_absolute_path(upload_dir, book_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(normalized)
    return cover_relative_path(book_id)


def _is_jpeg_or_png(content_type: str | None, filename: str | None) -> bool:
    ctype = (content_type or "").split(";")[0].strip().lower()
    ext = Path(filename or "").suffix.lower()
    if ctype in {"image/jpeg", "image/jpg", "image/png"}:
        return True
    return ext in {".jpg", ".jpeg", ".png"}


def _qualifies(raw: bytes) -> bool:
    if len(raw) < MIN_BYTES:
        return False
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:  # noqa: BLE001
        return False
    width, height = image.size
    short_edge, long_edge = sorted((width, height))
    if short_edge < MIN_SHORT_EDGE or long_edge < MIN_LONG_EDGE:
        return False
    # Prefer portrait; allow landscape only when both edges clear the bar.
    return True


def _iter_body_image_blobs(document: Document) -> list[bytes]:
    """Return JPEG/PNG blobs for inline images in body order (skip headers/footers)."""
    blobs: list[bytes] = []
    seen: set[str] = set()
    body = document.element.body
    for blip in body.iter(qn("a:blip")):
        embed = blip.get(qn("r:embed"))
        if not embed or embed in seen:
            continue
        seen.add(embed)
        try:
            part = document.part.related_parts[embed]
        except KeyError:
            continue
        content_type = getattr(part, "content_type", None)
        filename = Path(getattr(part, "partname", "")).name
        if not _is_jpeg_or_png(content_type, filename):
            continue
        blob = getattr(part, "blob", None)
        if not blob:
            continue
        blobs.append(blob)
    return blobs


def extract_cover_from_docx(docx_path: str | Path) -> bytes | None:
    """Pick the first qualifying body image, or None if none qualify."""
    try:
        document = Document(str(docx_path))
        for blob in _iter_body_image_blobs(document):
            if _qualifies(blob):
                return blob
    except Exception:  # noqa: BLE001
        logger.exception("Cover extraction failed for %s", docx_path)
    return None


def try_extract_and_save_cover(upload_dir: str | Path, book_id: str, docx_path: str | Path) -> str | None:
    """Fail-soft: return relative cover path or None without raising."""
    try:
        blob = extract_cover_from_docx(docx_path)
        if not blob:
            return None
        return save_cover_bytes(upload_dir, book_id, blob)
    except Exception:  # noqa: BLE001
        logger.exception("Could not save extracted cover for book %s", book_id)
        return None
