from docx import Document
from docx.oxml.ns import qn

from app.parse_docs import _docx_paragraph_to_markdown, extract_text_from_file


def add_hyperlink(paragraph, text: str) -> None:
    """Build a `<w:hyperlink><w:r>` wrapper, which python-docx cannot author."""
    hyperlink = paragraph._p.makeelement(qn("w:hyperlink"), {})
    run = paragraph._p.makeelement(qn("w:r"), {})
    text_node = paragraph._p.makeelement(qn("w:t"), {})
    text_node.text = text
    run.append(text_node)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def test_docx_runs_become_inline_markdown():
    document = Document()
    paragraph = document.add_paragraph()
    paragraph.add_run("Plain ")
    bold = paragraph.add_run("bold")
    bold.bold = True
    paragraph.add_run(", ")
    italic = paragraph.add_run("italic")
    italic.italic = True
    paragraph.add_run(", and ")
    both = paragraph.add_run("both")
    both.bold = True
    both.italic = True
    paragraph.add_run(".")

    assert _docx_paragraph_to_markdown(paragraph) == (
        "Plain **bold**, *italic*, and ***both***."
    )


def test_adjacent_runs_with_same_style_are_merged():
    document = Document()
    paragraph = document.add_paragraph()
    first = paragraph.add_run("two ")
    first.bold = True
    second = paragraph.add_run("runs")
    second.bold = True

    assert _docx_paragraph_to_markdown(paragraph) == "**two runs**"


def test_literal_markdown_characters_are_escaped():
    document = Document()
    paragraph = document.add_paragraph(r"Use * literally and keep \ paths")

    assert _docx_paragraph_to_markdown(paragraph) == (
        r"Use \* literally and keep \\ paths"
    )


def test_hyperlink_text_is_kept():
    document = Document()
    paragraph = document.add_paragraph()
    paragraph.add_run("See ")
    add_hyperlink(paragraph, "this page")
    paragraph.add_run(" for details.")

    assert _docx_paragraph_to_markdown(paragraph) == "See this page for details."


def test_paragraph_made_only_of_a_hyperlink_is_not_dropped():
    document = Document()
    paragraph = document.add_paragraph()
    add_hyperlink(paragraph, "Entirely a hyperlink.")

    assert _docx_paragraph_to_markdown(paragraph) == "Entirely a hyperlink."


def test_extract_includes_table_cells(tmp_path):
    document = Document()
    document.add_paragraph("Body paragraph.")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "First cell."
    table.rows[0].cells[1].text = "Second cell."
    path = tmp_path / "with-table.docx"
    document.save(path)

    text = extract_text_from_file(path, "with-table.docx")

    assert text.split("\n\n") == ["Body paragraph.", "First cell.", "Second cell."]
