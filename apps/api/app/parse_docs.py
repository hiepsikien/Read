from collections.abc import Iterator
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from pypdf import PdfReader


def extract_text_from_file(file_path: str | Path, original_name: str) -> str:
    path = Path(file_path)
    ext = Path(original_name).suffix.lower()

    if ext == ".pdf":
        return _extract_pdf(path)
    if ext == ".docx":
        return _extract_docx(path)
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


def _extract_docx(path: Path) -> str:
    document = Document(str(path))
    # Each DOCX paragraph is a real paragraph. Inline emphasis is encoded as a
    # small Markdown subset so it survives splitting and both readers.
    paragraphs = [
        markdown
        for paragraph in _iter_docx_paragraphs(document)
        if (markdown := _docx_paragraph_to_markdown(paragraph))
    ]
    text = "\n\n".join(paragraphs).replace("\r", "").strip()
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
