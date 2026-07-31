"""add reading_progress.completed_at

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-31
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE reading_progress
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE reading_progress DROP COLUMN IF EXISTS completed_at")
