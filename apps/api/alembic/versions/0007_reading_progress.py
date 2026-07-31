"""add per-user reading progress

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-31
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reading_progress (
            id VARCHAR(32) PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            book_id VARCHAR(32) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            chapter_id VARCHAR(32) REFERENCES chapters(id) ON DELETE SET NULL,
            chapter_position INTEGER,
            paragraph_index INTEGER NOT NULL DEFAULT 0,
            scroll_fraction DOUBLE PRECISION NOT NULL DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT uq_reading_progress_user_book UNIQUE (user_id, book_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reading_progress_user_updated "
        "ON reading_progress (user_id, updated_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_reading_progress_user_updated")
    op.execute("DROP TABLE IF EXISTS reading_progress")
