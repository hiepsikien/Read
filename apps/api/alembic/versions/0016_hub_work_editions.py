"""allow multiple Read books per Hub work

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-29
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_books_hub_work_id")
    op.execute("CREATE INDEX IF NOT EXISTS ix_books_hub_work_id ON books (hub_work_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_books_hub_work_id")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_books_hub_work_id
        ON books (hub_work_id)
        WHERE hub_work_id IS NOT NULL
        """
    )
