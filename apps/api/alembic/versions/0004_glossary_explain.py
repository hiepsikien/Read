"""glossary entries + explain response cache

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-30
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS glossary_entries (
            id VARCHAR(32) PRIMARY KEY,
            book_id VARCHAR(32) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            episode_key VARCHAR(32) NOT NULL DEFAULT '',
            episode_title VARCHAR(300) NOT NULL DEFAULT '',
            group_label VARCHAR(200) NOT NULL DEFAULT '',
            name VARCHAR(300) NOT NULL,
            aliases TEXT NOT NULL DEFAULT '[]',
            summary TEXT NOT NULL DEFAULT '',
            sort_key VARCHAR(300) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_glossary_book_sort ON glossary_entries (book_id, sort_key)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_glossary_book_episode ON glossary_entries (book_id, episode_key)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS explain_cache (
            id VARCHAR(32) PRIMARY KEY,
            book_id VARCHAR(32) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            chapter_id VARCHAR(32) NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
            cache_key VARCHAR(64) NOT NULL UNIQUE,
            response_json TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_explain_cache_book ON explain_cache (book_id, chapter_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS explain_cache")
    op.execute("DROP TABLE IF EXISTS glossary_entries")
