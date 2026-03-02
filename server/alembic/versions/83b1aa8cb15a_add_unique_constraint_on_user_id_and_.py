"""add unique constraint on user_id and device_fingerprint

Revision ID: 83b1aa8cb15a
Revises: 87ab147f0fb1
Create Date: 2026-03-01 18:04:04.532276

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "83b1aa8cb15a"
down_revision: str | Sequence[str] | None = "87ab147f0fb1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add unique constraint to prevent duplicate sessions per device.

    This migration:
    1. Cleans up existing duplicate sessions (keeps newest per device)
    2. Adds a partial unique index for active sessions only
    """

    # Step 1: Clean up existing duplicates (keep newest per device)
    # Uses window function to rank sessions by last_used_at, keeping only rn=1
    op.execute("""
        WITH ranked_tokens AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY user_id, device_fingerprint
                    ORDER BY last_used_at DESC
                ) AS rn
            FROM refresh_tokens
            WHERE is_revoked = false
              AND device_fingerprint IS NOT NULL
        )
        UPDATE refresh_tokens
        SET is_revoked = true, revoked_at = NOW()
        WHERE id IN (
            SELECT id FROM ranked_tokens WHERE rn > 1
        )
    """)

    # Step 2: Add partial unique index (only for non-revoked tokens)
    # PostgreSQL supports partial indexes with WHERE clause
    # This prevents duplicate active sessions per device while allowing
    # multiple revoked sessions (for audit history)
    op.execute("""
        CREATE UNIQUE INDEX idx_refresh_tokens_user_device_unique
        ON refresh_tokens (user_id, device_fingerprint)
        WHERE is_revoked = false AND device_fingerprint IS NOT NULL
    """)


def downgrade() -> None:
    """Remove unique constraint."""
    op.execute("DROP INDEX IF EXISTS idx_refresh_tokens_user_device_unique")
