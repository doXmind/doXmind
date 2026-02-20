"""Add community publishing fields to document_shares table.

Revision ID: 0007_community_shares
Revises: 0006_user_profile
Create Date: 2026-02-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_community_shares"
down_revision: str | Sequence[str] | None = "0006_user_profile"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add community publishing columns and indexes to document_shares."""
    op.add_column(
        "document_shares",
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("document_shares", sa.Column("title", sa.String(255), nullable=True))
    op.add_column("document_shares", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("document_shares", sa.Column("tags", sa.JSON(), nullable=True))
    op.add_column(
        "document_shares",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "document_shares",
        sa.Column("fork_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "document_shares",
        sa.Column("bookmark_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "document_shares",
        sa.Column("comment_count", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_index("idx_shares_published", "document_shares", ["is_published", "published_at"])
    op.create_index(
        "idx_shares_published_popular",
        "document_shares",
        ["is_published", "fork_count", "bookmark_count"],
    )


def downgrade() -> None:
    """Remove community publishing columns and indexes from document_shares."""
    op.drop_index("idx_shares_published_popular", table_name="document_shares")
    op.drop_index("idx_shares_published", table_name="document_shares")
    op.drop_column("document_shares", "comment_count")
    op.drop_column("document_shares", "bookmark_count")
    op.drop_column("document_shares", "fork_count")
    op.drop_column("document_shares", "published_at")
    op.drop_column("document_shares", "tags")
    op.drop_column("document_shares", "description")
    op.drop_column("document_shares", "title")
    op.drop_column("document_shares", "is_published")
