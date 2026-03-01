"""repair corrupted utf8 content in files

Revision ID: b4946964f9c0
Revises: 5c1bf0bceb3d
Create Date: 2026-02-26 23:47:42.399460

Strips null bytes and control characters from existing file content to
prevent substr() hangs and UTF-8 encoding errors.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4946964f9c0"
down_revision: str | Sequence[str] | None = "5c1bf0bceb3d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Strip null bytes and control characters from files and file_versions.

    Creates a temporary repair_content() PL/pgSQL function with a 5-second
    per-row timeout, then updates all rows. Rows that hang or error during
    content access are set to empty string.
    """
    # Create temporary repair function
    op.execute("""
        CREATE OR REPLACE FUNCTION repair_content(t text)
        RETURNS text AS $$
        DECLARE
            old_timeout text;
            cleaned text;
        BEGIN
            old_timeout := current_setting('statement_timeout');
            PERFORM set_config('statement_timeout', '5000', true);
            BEGIN
                -- Strip null bytes and control chars (preserve tab, newline, CR)
                cleaned := regexp_replace(t,
                    E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F]', '', 'g');
                PERFORM set_config('statement_timeout', old_timeout, true);
                RETURN cleaned;
            EXCEPTION WHEN OTHERS THEN
                PERFORM set_config('statement_timeout', old_timeout, true);
                RETURN '';
            END;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # Repair files table
    op.execute("""
        UPDATE files
        SET content = repair_content(content)
        WHERE content IS NOT NULL AND content != '';
    """)

    # Repair file_versions table
    op.execute("""
        UPDATE file_versions
        SET content = repair_content(content)
        WHERE content IS NOT NULL AND content != '';
    """)

    # Drop temporary function
    op.execute("DROP FUNCTION IF EXISTS repair_content(text);")


def downgrade() -> None:
    """No-op: cannot restore stripped characters."""
    pass
