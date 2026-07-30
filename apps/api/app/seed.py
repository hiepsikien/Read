from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import hash_password
from .categories import ensure_categories
from .chapters import count_words
from .models import Book, Chapter, User


SAMPLE_FREE = [
    {
        "title": "Chapter 1 — First Light",
        "content": (
            "The ferry left before the shops opened. Mist held the water so still that the hull seemed to slide across glass. "
            "Mara counted the buoys the way other people count breaths — one for luck, one for home, one for whatever waited on the far pier.\n\n"
            "She had packed lightly: a notebook, a thermos, and the letter she had not yet opened. The envelope was soft at the corners, "
            "carried too long in a coat pocket. On the front, in a careful hand, only her name.\n\n"
            "When the island appeared, it was smaller than memory. Rooflines leaned into the wind. A dog barked once and decided against a second try. "
            "Mara stepped onto the wet planks and felt the morning settle into her shoes."
        ),
    },
    {
        "title": "Chapter 2 — Harbor Names",
        "content": (
            "Old maps still used names the tourists never learned. The green shed by the winch was not a shed; it was the Listening House, "
            "where nets were mended and gossip was sorted by tide.\n\n"
            "Mara asked for tea and received advice. “If you walk the north path before noon,” said the woman with salt in her hair, "
            "“the cliffs keep their stories. After noon they only keep their wind.”\n\n"
            "She walked anyway, both before and after, and wrote down the names painted under peeling signs: Knot Mercy, Quiet Debt, Second Chance Cove. "
            "Some names were jokes. Some were warnings wearing joke clothes."
        ),
    },
    {
        "title": "Chapter 3 — The Unopened Letter",
        "content": (
            "On the third evening she opened the letter. It did not ask her to return. It asked her to look carefully.\n\n"
            "“There is a bench facing west,” it said. “Sit until the lighthouse forgets to impress anyone. Then write what remains.”\n\n"
            "Mara sat. The light swept the water with professional patience. What remained was simple: a coast that did not need her, "
            "and a notebook that somehow did. She began with the ferry, then the buoys, then the dog that barked once. "
            "By midnight the quiet coast had become a book in waiting."
        ),
    },
]

SAMPLE_PAID = [
    {
        "title": "Chapter 1 — Ink That Moves",
        "content": (
            "The apprenticeship began with a warning: never trust a map that looks finished.\n\n"
            "Eli arrived with clean sleeves and an expensive compass. Master Rowan gave him a table by the window, a jar of iron gall ink, "
            "and a coastline that refused to agree with itself. Each morning the peninsula drifted a finger’s width. "
            "Each evening the harbor mouth narrowed as if embarrassed by visitors.\n\n"
            "“You are not here to copy the world,” Rowan said. “You are here to notice when the world edits you.”\n\n"
            "Eli laughed, then stopped laughing when his own sketch erased a road he was certain he had drawn."
        ),
    },
    {
        "title": "Chapter 2 — The Client from Nowhere",
        "content": (
            "She wore no crest and paid in unmarked silver. She wanted a map of a city that did not appear in any ledger. "
            "“It exists on Tuesdays,” she said, as if that clarified the contract.\n\n"
            "Rowan accepted. Eli protested. The silver stayed.\n\n"
            "They drafted grids, erased grids, and argued about north. On the seventh draft a plaza appeared that neither of them remembered inventing. "
            "In the plaza stood a fountain shaped like an open book. Eli touched the parchment and felt damp stone."
        ),
    },
    {
        "title": "Chapter 3 — Borders with Opinions",
        "content": (
            "Borders, Rowan taught, are gossip that got promoted.\n\n"
            "The Tuesday city grew confident. Alleys multiplied overnight. A wall migrated three streets west and took two bakeries with it. "
            "Eli began sleeping in the studio so he would not miss a revision.\n\n"
            "One dawn he found a note in his own handwriting he did not recall writing: “Follow the fountain. Bring no finished maps.”"
        ),
    },
    {
        "title": "Chapter 4 — Apprentice No Longer",
        "content": (
            "When Eli stepped into the plaza, the fountain’s water ran with ink. Rowan waited on the far side, older and somehow less surprised.\n\n"
            "“Every cartographer becomes the territory eventually,” Rowan said. “The work is choosing which coast you become.”\n\n"
            "Eli set down his blank sheet. For the first time the paper stayed blank on purpose. The city paused, polite as a held breath, "
            "and let him decide where north should begin."
        ),
    },
]


def seed_if_empty(db: Session) -> None:
    categories = ensure_categories(db)
    fiction = next((c for c in categories if c.slug == "fiction"), categories[0])

    count = db.scalar(select(func.count()).select_from(User)) or 0
    if count > 0:
        return

    now = datetime.now(timezone.utc)
    publisher_id = generate()
    reader_id = generate()
    admin_id = generate()
    free_book_id = generate()
    paid_book_id = generate()

    publisher = User(
        id=publisher_id,
        firebase_uid=f"dev-{publisher_id}",
        email="publisher@read.app",
        name="North Harbor Press",
        role="publisher",
        password_hash=hash_password("publisher123"),
        created_at=now,
    )
    reader = User(
        id=reader_id,
        firebase_uid=f"dev-{reader_id}",
        email="reader@read.app",
        name="Alex Reader",
        role="reader",
        password_hash=hash_password("reader123"),
        created_at=now,
    )
    admin = User(
        id=admin_id,
        firebase_uid=f"dev-{admin_id}",
        email="admin@read.app",
        name="Read Admin",
        role="admin",
        password_hash=hash_password("admin123"),
        created_at=now,
    )
    db.add_all([publisher, reader, admin])

    free_text = "\n\n".join(f"{c['title']}\n\n{c['content']}" for c in SAMPLE_FREE)
    paid_text = "\n\n".join(f"{c['title']}\n\n{c['content']}" for c in SAMPLE_PAID)

    free_book = Book(
        id=free_book_id,
        publisher_id=publisher_id,
        category_id=fiction.id,
        title="Letters from the Quiet Coast",
        description=(
            "A short free collection of coastal sketches — mornings, harbors, and the people who wait for the tide."
        ),
        price_cents=0,
        status="published",
        source_filename=None,
        source_path=None,
        raw_text=free_text,
        created_at=now,
        updated_at=now,
    )
    paid_book = Book(
        id=paid_book_id,
        publisher_id=publisher_id,
        category_id=fiction.id,
        title="The Cartographer's Apprentice",
        description=(
            "A paid novella about maps that refuse to stay still. Chapter 1 is free; unlock the rest with a mock purchase."
        ),
        price_cents=499,
        status="published",
        source_filename=None,
        source_path=None,
        raw_text=paid_text,
        created_at=now,
        updated_at=now,
    )
    db.add_all([free_book, paid_book])

    for index, chapter in enumerate(SAMPLE_FREE):
        db.add(
            Chapter(
                id=generate(),
                book_id=free_book_id,
                position=index + 1,
                title=chapter["title"],
                content=chapter["content"],
                word_count=count_words(chapter["content"]),
                group_index=index + 1,
            )
        )

    for index, chapter in enumerate(SAMPLE_PAID):
        db.add(
            Chapter(
                id=generate(),
                book_id=paid_book_id,
                position=index + 1,
                title=chapter["title"],
                content=chapter["content"],
                word_count=count_words(chapter["content"]),
                group_index=index + 1,
            )
        )

    db.commit()
