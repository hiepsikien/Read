"""empty bibliographic credits on books

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-29
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS author_name VARCHAR(255) NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS author_hub_id VARCHAR(80) NOT NULL DEFAULT ''")
    op.execute(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS translator_name VARCHAR(255) NOT NULL DEFAULT ''"
    )
    op.execute(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS translator_role VARCHAR(64) NOT NULL DEFAULT ''"
    )
    op.execute(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS source_hub_work_id VARCHAR(120) NOT NULL DEFAULT ''"
    )
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS source_title VARCHAR(500) NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS source_year INTEGER")
    op.execute(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS source_language VARCHAR(16) NOT NULL DEFAULT ''"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS source_language")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS source_year")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS source_title")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS source_hub_work_id")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS translator_role")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS translator_name")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS author_hub_id")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS author_name")
