"""add share_views table and reaction_count to document_shares

Revision ID: 0018_share_views
Revises: 0017_allow_fork
Create Date: 2026-03-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018_share_views"
down_revision: str | Sequence[str] | None = "0017_allow_fork"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create share_views table and add reaction_count to document_shares."""
    # 1. Create share_views table for per-user view tracking (if not already exists)
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    if "share_views" not in inspector.get_table_names():
        op.create_table(
            "share_views",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("share_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["share_id"], ["document_shares.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_share_views_share_id"), "share_views", ["share_id"], unique=False)
        op.create_index(op.f("ix_share_views_user_id"), "share_views", ["user_id"], unique=False)
        op.create_index(
            "idx_share_views_user_share", "share_views", ["user_id", "share_id"], unique=True
        )
        op.create_index(
            "idx_share_views_user_created",
            "share_views",
            ["user_id", "created_at"],
            unique=False,
        )

    # 2. Add denormalized reaction_count to document_shares (if not already exists)
    ds_cols = {c["name"] for c in inspector.get_columns("document_shares")}
    if "reaction_count" not in ds_cols:
        op.add_column(
            "document_shares",
            sa.Column("reaction_count", sa.Integer(), server_default="0", nullable=False),
        )

    # 3. Backfill reaction_count from existing share_reactions
    op.execute(
        sa.text("""
            UPDATE document_shares
            SET reaction_count = (
                SELECT COUNT(*)
                FROM share_reactions
                WHERE share_reactions.share_id = document_shares.id
            )
            WHERE EXISTS (
                SELECT 1 FROM share_reactions
                WHERE share_reactions.share_id = document_shares.id
            )
        """)
    )


def downgrade() -> None:
    """Drop share_views table and reaction_count column."""
    op.drop_column("document_shares", "reaction_count")
    op.drop_index("idx_share_views_user_created", table_name="share_views")
    op.drop_index("idx_share_views_user_share", table_name="share_views")
    op.drop_index(op.f("ix_share_views_user_id"), table_name="share_views")
    op.drop_index(op.f("ix_share_views_share_id"), table_name="share_views")
    op.drop_table("share_views")
