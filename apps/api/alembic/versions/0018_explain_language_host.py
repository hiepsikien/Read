"""book language + note host paragraph for explain

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-03
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS language VARCHAR(16) NOT NULL DEFAULT ''")
    op.execute(
        "ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS host_block_id VARCHAR(128) NOT NULL DEFAULT ''"
    )
    op.execute("ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS host_text TEXT NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS figures_json TEXT NOT NULL DEFAULT '[]'")


def downgrade() -> None:
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS figures_json")
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS host_text")
    op.execute("ALTER TABLE glossary_entries DROP COLUMN IF EXISTS host_block_id")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS language")
