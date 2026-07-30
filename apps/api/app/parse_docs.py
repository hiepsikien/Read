from pathlib import Path

from docx import Document
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
    text = "\n".join(p.text for p in document.paragraphs).replace("\r", "").strip()
    if not text:
        raise ValueError("No text could be extracted from this DOCX.")
    return text
