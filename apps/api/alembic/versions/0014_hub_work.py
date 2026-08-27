"""add Knowledge Hub book linkage

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-27
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS hub_work_id VARCHAR(120)")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS hub_version INTEGER")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS hub_content_hash VARCHAR(64)")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS hub_license_snapshot TEXT")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_books_hub_work_id
        ON books (hub_work_id)
        WHERE hub_work_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_books_hub_work_id")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS hub_license_snapshot")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS hub_content_hash")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS hub_version")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS hub_work_id")
