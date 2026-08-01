"""add series catalog and book season/episode placement

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-01
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS series (
            id VARCHAR(32) PRIMARY KEY,
            publisher_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(500) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            cover_path VARCHAR(1000),
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        """
        ALTER TABLE books
        ADD COLUMN IF NOT EXISTS series_id VARCHAR(32)
            REFERENCES series(id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        ALTER TABLE books
        ADD COLUMN IF NOT EXISTS season_number INTEGER
        """
    )
    op.execute(
        """
        ALTER TABLE books
        ADD COLUMN IF NOT EXISTS episode_number INTEGER
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_books_series_id ON books (series_id)
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'ck_books_series_placement'
            ) THEN
                ALTER TABLE books
                ADD CONSTRAINT ck_books_series_placement CHECK (
                    (
                        series_id IS NULL
                        AND season_number IS NULL
                        AND episode_number IS NULL
                    ) OR (
                        series_id IS NOT NULL
                        AND season_number IS NOT NULL
                        AND episode_number IS NOT NULL
                        AND season_number > 0
                        AND episode_number > 0
                    )
                );
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_books_series_season_episode'
            ) THEN
                ALTER TABLE books
                ADD CONSTRAINT uq_books_series_season_episode
                UNIQUE (series_id, season_number, episode_number);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS uq_books_series_season_episode")
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS ck_books_series_placement")
    op.execute("DROP INDEX IF EXISTS ix_books_series_id")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS episode_number")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS season_number")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS series_id")
    op.execute("DROP TABLE IF EXISTS series")
