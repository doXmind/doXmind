"""Add icon column to files table for document emoji icons.

Revision ID: 0004_add_icon
Revises: 0003_add_deleted_at
Create Date: 2026-02-10
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_add_icon"
down_revision: str | Sequence[str] | None = "0003_add_deleted_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add icon column to files table."""
    op.add_column("files", sa.Column("icon", sa.String(10), nullable=True))


def downgrade() -> None:
    """Remove icon column."""
    op.drop_column("files", "icon")
