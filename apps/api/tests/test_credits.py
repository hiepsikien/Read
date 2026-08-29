from app.credits import credits_payload, empty_credits, normalize_credits


class _Book:
    def __init__(self, **kwargs):
        self.author_name = ""
        self.author_hub_id = ""
        self.translator_name = ""
        self.translator_role = ""
        self.source_hub_work_id = ""
        self.source_title = ""
        self.source_year = None
        self.source_language = ""
        self.publisher = type("P", (), {"name": "Indie Author"})()
        for key, value in kwargs.items():
            setattr(self, key, value)


def test_empty_credits_shape():
    assert empty_credits() == {
        "author_name": "",
        "author_hub_id": "",
        "translator_name": "",
        "translator_role": "",
        "source": None,
    }


def test_normalize_credits_ignores_blank_source():
    assert normalize_credits(None)["source"] is None
    assert normalize_credits({"source": {"title": "  "}})["source"] is None


def test_credits_payload_falls_back_to_publisher():
    book = _Book()
    payload = credits_payload(book, publisher_name="Indie Author")
    assert payload["author_name"] == "Indie Author"
    assert payload["source"] is None
    assert payload["translator_name"] == ""


def test_credits_payload_keeps_hub_author():
    book = _Book(
        author_name="Hugo Grotius",
        author_hub_id="grotius",
        translator_name="Knowledge Hub",
        translator_role="hub_editorial",
        source_hub_work_id="grotius--freedom_of_the_seas",
        source_title="The Freedom of the Seas",
        source_year=1609,
        source_language="en",
    )
    payload = credits_payload(book, publisher_name="Knowledge Hub")
    assert payload["author_name"] == "Hugo Grotius"
    assert payload["source"]["year"] == 1609
