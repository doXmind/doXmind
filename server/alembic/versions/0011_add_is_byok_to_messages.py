"""Add is_byok column to messages table.

Tracks whether a message was generated using the user's own API key (BYOK)
vs the platform's server key. Needed for per-user token quota accounting.

Revision ID: 0011_add_is_byok
Revises: 0010_token_columns
Create Date: 2026-02-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011_add_is_byok"
down_revision: str = "0010_token_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add is_byok Boolean column with default False."""
    op.add_column(
        "messages",
        sa.Column("is_byok", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    """Remove is_byok column."""
    op.drop_column("messages", "is_byok")
