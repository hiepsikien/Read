from collections.abc import Iterator
from pathlib import Path
import re

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from pypdf import PdfReader

from .media import (
    is_jpeg_or_png,
    media_url_for,
    qualifies_as_inline_media,
    save_media_bytes,
)

_GENERIC_PICTURE_NAME = re.compile(
    r"^(?:picture|image|photo|img|hình(?:\s*ảnh)?|ảnh)[\s._-]?\d*$",
    re.I,
)
_FILENAME_LIKE_CAPTION = re.compile(
    r".*\.(?:jpe?g|png|webp|gif|bmp|tiff?)$",
    re.I,
)


def extract_text_from_file(
    file_path: str | Path,
    original_name: str,
    *,
    media_dir: str | Path | None = None,
    book_id: str | None = None,
) -> str:
    path = Path(file_path)
    ext = Path(original_name).suffix.lower()

    if ext == ".pdf":
        return _extract_pdf(path)
    if ext == ".docx":
        return _extract_docx(path, media_dir=media_dir, book_id=book_id)
    raise ValueError("Unsupported file type. Please upload a PDF or DOCX file.")


def _extract_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    text = "\n".join(parts).replace("\r", "").strip()
    if not text:
        raise ValueError("No text could be extracted from this PDF.")
    return text


def _extract_docx(
    path: Path,
    *,
    media_dir: str | Path | None = None,
    book_id: str | None = None,
) -> str:
    document = Document(str(path))
    # Each DOCX paragraph is a real paragraph. Inline emphasis is encoded as a
    # small Markdown subset so it survives splitting and both readers. Body
    # images become figure blocks: ![caption](/api/books/{id}/media/{asset}.jpg).
    extract_media = media_dir is not None and book_id is not None
    paragraphs = list(_iter_docx_paragraphs(document))
    blocks: list[str] = []
    index = 0
    while index < len(paragraphs):
        paragraph = paragraphs[index]
        images = (
            _paragraph_images(paragraph, document) if extract_media else []
        )
        text = _docx_paragraph_to_markdown(paragraph)

        if images:
            if text:
                blocks.append(text)
            for image_index, (blob, alt) in enumerate(images):
                caption = alt
                consume_caption = (
                    image_index == len(images) - 1
                    and index + 1 < len(paragraphs)
                    and _is_caption_paragraph(paragraphs[index + 1])
                )
                if consume_caption:
                    next_text = (paragraphs[index + 1].text or "").replace("\r", " ").strip()
                    if next_text:
                        caption = next_text
                try:
                    asset_id = save_media_bytes(media_dir, book_id, blob)
                except Exception:  # noqa: BLE001 - skip corrupt embeds
                    if consume_caption and caption and caption != alt:
                        # Keep the caption prose even if the image could not be saved.
                        blocks.append(caption)
                        index += 1
                    continue
                if consume_caption:
                    index += 1
                blocks.append(
                    f"![{_escape_caption(caption)}]({media_url_for(book_id, asset_id)})"
                )
        elif text:
            blocks.append(text)
        index += 1

    text = "\n\n".join(blocks).replace("\r", "").strip()
    if not text:
        raise ValueError(
            "No text could be extracted from this DOCX. "
            "If it was exported from a scan, the pages hold images rather than text."
        )
    return text


def _iter_docx_paragraphs(document) -> Iterator[Paragraph]:
    """Body paragraphs plus paragraphs nested in tables, in document order."""
    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            table = Table(child, document)
            for row in table.rows:
                for cell in row.cells:
                    yield from cell.paragraphs


def _style_flag(styled, attribute: str) -> bool | None:
    """Read a font flag off a run or style, tolerating missing style parts."""
    try:
        font = styled.font
    except AttributeError:
        return None
    return getattr(font, attribute, None)


def _effective_run_style(run: Run, paragraph: Paragraph, attribute: str) -> bool:
    """Resolve direct formatting, then character and paragraph styles."""
    direct = getattr(run, attribute, None)
    if direct is not None:
        return bool(direct)

    for source in (run.style, paragraph.style):
        if source is None:
            continue
        inherited = _style_flag(source, attribute)
        if inherited is not None:
            return bool(inherited)

    return False


def _escape_markdown(text: str) -> str:
    return text.replace("\\", "\\\\").replace("*", "\\*")


def _escape_caption(text: str) -> str:
    return (
        (text or "")
        .replace("\\", "\\\\")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace("\n", " ")
        .strip()
    )


def _styled_run(text: str, *, bold: bool, italic: bool) -> str:
    # Markers must sit next to visible text; whitespace outside a marker keeps
    # adjacent runs valid Markdown and avoids `** word **` edge cases.
    leading = text[: len(text) - len(text.lstrip())]
    trailing = text[len(text.rstrip()) :]
    core_end = len(text) - len(trailing) if trailing else len(text)
    core = text[len(leading) : core_end]
    if not core:
        return text

    escaped = _escape_markdown(core)
    marker = "***" if bold and italic else "**" if bold else "*" if italic else ""
    return f"{leading}{marker}{escaped}{marker}{trailing}"


def _paragraph_runs(paragraph: Paragraph) -> list[Run]:
    """All visible runs, including those nested inside hyperlinks.

    `Paragraph.runs` only returns direct `<w:r>` children, so hyperlink text
    would silently disappear — `Paragraph.text` includes it.
    """
    runs: list[Run] = []
    for item in paragraph.iter_inner_content():
        nested = getattr(item, "runs", None)
        if nested is None:
            runs.append(item)
        else:
            runs.extend(nested)
    return runs


def _docx_paragraph_to_markdown(paragraph: Paragraph) -> str:
    try:
        markdown = _paragraph_markdown(paragraph)
    except Exception:  # noqa: BLE001 - unknown markup must not fail an upload
        markdown = ""

    # Never regress below the plain projection if the run walk missed content,
    # e.g. text wrapped in markup this importer does not model yet.
    return markdown or paragraph.text.strip()


def _paragraph_markdown(paragraph: Paragraph) -> str:
    segments: list[tuple[str, bool, bool]] = []
    for run in _paragraph_runs(paragraph):
        text = run.text.replace("\r", "").replace("\n", " ")
        if not text:
            continue
        bold = _effective_run_style(run, paragraph, "bold")
        italic = _effective_run_style(run, paragraph, "italic")
        if segments and segments[-1][1:] == (bold, italic):
            previous, _, _ = segments[-1]
            segments[-1] = (previous + text, bold, italic)
        else:
            segments.append((text, bold, italic))

    return "".join(
        _styled_run(text, bold=bold, italic=italic)
        for text, bold, italic in segments
    ).strip()


def _is_caption_paragraph(paragraph: Paragraph) -> bool:
    style = paragraph.style
    name = (style.name if style else "") or ""
    if "caption" in name.lower() or "chú thích" in name.lower():
        return True
    # Some exports keep the style id on the paragraph even when the named style
    # is missing from the document's style gallery.
    p_style = paragraph._p.find(qn("w:pPr"))
    if p_style is not None:
        style_el = p_style.find(qn("w:pStyle"))
        if style_el is not None:
            val = (style_el.get(qn("w:val")) or "").lower()
            if "caption" in val:
                return True
    return False


def _usable_drawing_label(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    if _GENERIC_PICTURE_NAME.match(text) or _FILENAME_LIKE_CAPTION.match(text):
        return ""
    return text


def _drawing_alt_text(drawing) -> str:
    for doc_pr in drawing.iter(qn("wp:docPr")):
        descr = _usable_drawing_label(doc_pr.get("descr") or "")
        if descr:
            return descr
        name = _usable_drawing_label(doc_pr.get("name") or "")
        if name:
            return name
    return ""


def _paragraph_images(paragraph: Paragraph, document: Document) -> list[tuple[bytes, str]]:
    """Return (blob, alt_text) for each inline JPEG/PNG/WebP in the paragraph."""
    results: list[tuple[bytes, str]] = []
    seen: set[str] = set()
    for drawing in paragraph._p.iter(qn("w:drawing")):
        alt = _drawing_alt_text(drawing)
        for blip in drawing.iter(qn("a:blip")):
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
            if not is_jpeg_or_png(content_type, filename):
                continue
            blob = getattr(part, "blob", None)
            if not blob or not qualifies_as_inline_media(blob):
                continue
            results.append((blob, alt))
    return results
