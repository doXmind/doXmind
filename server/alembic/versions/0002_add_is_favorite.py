"""Add is_favorite to files table.

Revision ID: 0002_add_is_favorite
Revises: 82a963c924d8
Create Date: 2026-02-04

Note: deleted_at is already in baseline migration (0001).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_add_is_favorite"
down_revision: str | Sequence[str] | None = "82a963c924d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add is_favorite to files table."""
    op.add_column("files", sa.Column("is_favorite", sa.Boolean(), server_default="false"))


def downgrade() -> None:
    """Remove is_favorite column."""
    op.drop_column("files", "is_favorite")
