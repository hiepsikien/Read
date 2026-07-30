"""add unique public handles for users

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-30
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS handle VARCHAR(30)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_handle_lower "
        "ON users (lower(handle)) WHERE handle IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_users_handle_lower")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS handle")
