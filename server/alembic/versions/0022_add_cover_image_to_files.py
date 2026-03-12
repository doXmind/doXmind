"""Add cover_image_url and cover_position columns to files table.

Revision ID: 0022_cover_image
Revises: 0021_inline_anchors
Create Date: 2026-03-10
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0022_cover_image"
down_revision: str | Sequence[str] | None = "0021_inline_anchors"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add cover image fields to files table."""
    op.add_column("files", sa.Column("cover_image_url", sa.Text(), nullable=True))
    op.add_column(
        "files", sa.Column("cover_position", sa.Float(), server_default="0.5", nullable=True)
    )


def downgrade() -> None:
    """Remove cover image fields."""
    op.drop_column("files", "cover_position")
    op.drop_column("files", "cover_image_url")
