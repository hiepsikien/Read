"""book covers: cover_path on books

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-30
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_path VARCHAR(1000)")


def downgrade() -> None:
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS cover_path")
