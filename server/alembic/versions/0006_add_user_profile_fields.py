"""Add profile fields (bio, website, social_links) to users table.

Revision ID: 0006_user_profile
Revises: 0005_msg_index
Create Date: 2026-02-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_user_profile"
down_revision: str | Sequence[str] | None = "0005_msg_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add bio, website, social_links columns to users."""
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("website", sa.String(500), nullable=True))
    op.add_column("users", sa.Column("social_links", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Remove profile columns from users."""
    op.drop_column("users", "social_links")
    op.drop_column("users", "website")
    op.drop_column("users", "bio")
