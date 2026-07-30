"""publishing foundation: firebase, admin, categories, moderation

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            id VARCHAR(32) PRIMARY KEY,
            slug VARCHAR(64) NOT NULL UNIQUE,
            label VARCHAR(120) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
        """
    )

    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_firebase_uid ON users (firebase_uid)"
    )
    op.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")

    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role")
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_role "
        "CHECK (role IN ('reader', 'publisher', 'admin'))"
    )

    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS category_id VARCHAR(32)")
    op.execute(
        """
        DO $$ BEGIN
          ALTER TABLE books
            ADD CONSTRAINT fk_books_category_id
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(32)")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS review_note TEXT")
    op.execute(
        """
        DO $$ BEGIN
          ALTER TABLE books
            ADD CONSTRAINT fk_books_reviewed_by
            FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )

    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS ck_books_status")
    op.execute(
        "ALTER TABLE books ADD CONSTRAINT ck_books_status "
        "CHECK (status IN ('draft', 'pending_review', 'published', 'rejected'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS ck_books_status")
    op.execute(
        "ALTER TABLE books ADD CONSTRAINT ck_books_status "
        "CHECK (status IN ('draft', 'published'))"
    )
    op.drop_constraint("fk_books_reviewed_by", "books", type_="foreignkey")
    op.drop_column("books", "review_note")
    op.drop_column("books", "reviewed_by")
    op.drop_column("books", "reviewed_at")
    op.drop_column("books", "submitted_at")
    op.drop_constraint("fk_books_category_id", "books", type_="foreignkey")
    op.drop_column("books", "category_id")

    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role")
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_role "
        "CHECK (role IN ('reader', 'publisher'))"
    )
    op.drop_index("ix_users_firebase_uid", table_name="users")
    op.drop_column("users", "firebase_uid")
    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=False)
    op.drop_table("categories")
