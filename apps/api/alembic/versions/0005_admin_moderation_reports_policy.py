"""admin moderation, reports, and legal acceptance

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-30
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_legal_version VARCHAR(32)")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_legal_at TIMESTAMP WITH TIME ZONE"
    )

    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS featured_by VARCHAR(32)")
    op.execute(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) "
        "NOT NULL DEFAULT 'listed'"
    )
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS visibility_note TEXT")
    op.execute(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS visibility_changed_at TIMESTAMP WITH TIME ZONE"
    )
    op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS visibility_changed_by VARCHAR(32)")
    op.execute(
        """
        DO $$ BEGIN
          ALTER TABLE books ADD CONSTRAINT fk_books_featured_by
            FOREIGN KEY (featured_by) REFERENCES users(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
          ALTER TABLE books ADD CONSTRAINT fk_books_visibility_changed_by
            FOREIGN KEY (visibility_changed_by) REFERENCES users(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS ck_books_visibility")
    op.execute(
        "ALTER TABLE books ADD CONSTRAINT ck_books_visibility "
        "CHECK (visibility IN ('listed', 'hidden', 'removed'))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_books_admin_catalog "
        "ON books (status, visibility, featured, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS moderation_events (
            id VARCHAR(32) PRIMARY KEY,
            book_id VARCHAR(32) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            actor_id VARCHAR(32) REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(64) NOT NULL,
            from_status VARCHAR(32),
            to_status VARCHAR(32),
            from_visibility VARCHAR(32),
            to_visibility VARCHAR(32),
            note TEXT,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_moderation_events_book_created "
        "ON moderation_events (book_id, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS content_reports (
            id VARCHAR(32) PRIMARY KEY,
            reporter_user_id VARCHAR(32) REFERENCES users(id) ON DELETE SET NULL,
            book_id VARCHAR(32) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            reason VARCHAR(32) NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            status VARCHAR(32) NOT NULL DEFAULT 'open',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            resolved_at TIMESTAMP WITH TIME ZONE,
            resolved_by VARCHAR(32) REFERENCES users(id) ON DELETE SET NULL,
            resolution_note TEXT,
            CONSTRAINT ck_content_reports_reason
              CHECK (reason IN ('copyright', 'inappropriate', 'spam', 'misleading', 'other')),
            CONSTRAINT ck_content_reports_status
              CHECK (status IN ('open', 'resolved', 'dismissed'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_content_reports_status_created "
        "ON content_reports (status, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_content_reports_book ON content_reports (book_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_content_reports_open_reporter_book "
        "ON content_reports (reporter_user_id, book_id) WHERE status = 'open'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_content_reports_open_reporter_book")
    op.execute("DROP INDEX IF EXISTS ix_content_reports_book")
    op.execute("DROP INDEX IF EXISTS ix_content_reports_status_created")
    op.execute("DROP TABLE IF EXISTS content_reports")
    op.execute("DROP INDEX IF EXISTS ix_moderation_events_book_created")
    op.execute("DROP TABLE IF EXISTS moderation_events")
    op.execute("DROP INDEX IF EXISTS ix_books_admin_catalog")
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS ck_books_visibility")
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS fk_books_visibility_changed_by")
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS fk_books_featured_by")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS visibility_changed_by")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS visibility_changed_at")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS visibility_note")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS visibility")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS featured_by")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS featured_at")
    op.execute("ALTER TABLE books DROP COLUMN IF EXISTS featured")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS accepted_legal_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS accepted_legal_version")
