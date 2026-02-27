"""add safe_substr function for encoding resilience

Revision ID: 5c1bf0bceb3d
Revises: a5c0f4c2c37b
Create Date: 2026-02-26 23:20:56.852666

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c1bf0bceb3d"
down_revision: str | Sequence[str] | None = "a5c0f4c2c37b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create safe_substr function that handles encoding errors gracefully.

    Uses a 2-second statement_timeout to prevent hangs on severely
    corrupted TOAST data, then catches any remaining errors.
    """
    op.execute("""
        CREATE OR REPLACE FUNCTION safe_substr(t text, start_pos int, len int)
        RETURNS text AS $$
        DECLARE
            old_timeout text;
            result text;
        BEGIN
            old_timeout := current_setting('statement_timeout');
            PERFORM set_config('statement_timeout', '2000', true);
            BEGIN
                result := substr(t, start_pos, len);
                PERFORM set_config('statement_timeout', old_timeout, true);
                RETURN result;
            EXCEPTION WHEN OTHERS THEN
                PERFORM set_config('statement_timeout', old_timeout, true);
                RETURN '';
            END;
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    """Drop safe_substr function."""
    op.execute("DROP FUNCTION IF EXISTS safe_substr(text, int, int);")
