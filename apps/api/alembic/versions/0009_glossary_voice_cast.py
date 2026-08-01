"""add glossary gender, age_band, tts_voice for narration casting

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-31
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE glossary_entries
        ADD COLUMN IF NOT EXISTS gender VARCHAR(16) NOT NULL DEFAULT ''
        """
    )
    op.execute(
        """
        ALTER TABLE glossary_entries
        ADD COLUMN IF NOT EXISTS age_band VARCHAR(16) NOT NULL DEFAULT ''
        """
    )
    op.execute(
        """
        ALTER TABLE glossary_entries
        ADD COLUMN IF NOT EXISTS tts_voice VARCHAR(128) NOT NULL DEFAULT ''
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS tts_voice")
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS age_band")
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS gender")
