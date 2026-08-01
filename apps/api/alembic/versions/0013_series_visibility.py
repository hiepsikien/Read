"""add series visibility listed|hidden

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-01
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE series
        ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) NOT NULL DEFAULT 'listed'
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'ck_series_visibility'
            ) THEN
                ALTER TABLE series
                ADD CONSTRAINT ck_series_visibility
                CHECK (visibility IN ('listed', 'hidden'));
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE series DROP CONSTRAINT IF EXISTS ck_series_visibility")
    op.execute("ALTER TABLE series DROP COLUMN IF EXISTS visibility")
