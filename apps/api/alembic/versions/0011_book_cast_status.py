"""add books.cast_status and cast_overrides for audio editorial

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-31
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE books
        ADD COLUMN IF NOT EXISTS cast_status VARCHAR(16) NOT NULL DEFAULT 'draft'
        """
    )
    op.execute(
        """
        ALTER TABLE books
        ADD COLUMN IF NOT EXISTS cast_overrides TEXT NOT NULL DEFAULT '{}'
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS cast_overrides")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS cast_status")
