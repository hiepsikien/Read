"""store Hub REF edition metadata and chapter blocks

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("books", sa.Column("edition_format", sa.String(length=32), nullable=True))
    op.add_column("books", sa.Column("edition_hash", sa.String(length=64), nullable=True))
    op.add_column("books", sa.Column("content_kind", sa.String(length=32), nullable=True))
    op.add_column("chapters", sa.Column("hub_chapter_id", sa.String(length=64), nullable=True))
    op.add_column("chapters", sa.Column("blocks_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chapters", "blocks_json")
    op.drop_column("chapters", "hub_chapter_id")
    op.drop_column("books", "content_kind")
    op.drop_column("books", "edition_hash")
    op.drop_column("books", "edition_format")
