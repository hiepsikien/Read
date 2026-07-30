"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-07-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('reader', 'publisher')", name="ck_users_role"),
    )
    op.create_table(
        "books",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("publisher_id", sa.String(length=32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source_filename", sa.String(length=500), nullable=True),
        sa.Column("source_path", sa.String(length=1000), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'published')", name="ck_books_status"),
    )
    op.create_table(
        "chapters",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("book_id", sa.String(length=32), sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False),
        sa.Column("group_index", sa.Integer(), nullable=False),
    )
    op.create_table(
        "purchases",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("user_id", sa.String(length=32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("book_id", sa.String(length=32), sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "book_id", name="uq_purchases_user_book"),
    )
    op.create_index("idx_books_status", "books", ["status"])
    op.create_index("idx_chapters_book", "chapters", ["book_id", "position"])


def downgrade() -> None:
    op.drop_index("idx_chapters_book", table_name="chapters")
    op.drop_index("idx_books_status", table_name="books")
    op.drop_table("purchases")
    op.drop_table("chapters")
    op.drop_table("books")
    op.drop_table("users")
