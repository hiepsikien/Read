"""add glossary presence + cast_locked for admin voice casting

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-31
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE glossary_entries
        ADD COLUMN IF NOT EXISTS presence VARCHAR(16) NOT NULL DEFAULT ''
        """
    )
    op.execute(
        """
        ALTER TABLE glossary_entries
        ADD COLUMN IF NOT EXISTS cast_locked BOOLEAN NOT NULL DEFAULT FALSE
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS cast_locked")
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS presence")
