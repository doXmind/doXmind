"""add inline comment anchor fields to comments table

Revision ID: 0021_inline_anchors
Revises: b8357ee86310
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0021_inline_anchors"
down_revision: Union[str, Sequence[str], None] = "b8357ee86310"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add inline comment anchor fields."""
    # Anchor position fields (nullable — NULL means document-level comment)
    op.add_column("comments", sa.Column("anchor_from", sa.Integer(), nullable=True))
    op.add_column("comments", sa.Column("anchor_to", sa.Integer(), nullable=True))
    op.add_column(
        "comments", sa.Column("anchor_text", sa.String(length=500), nullable=True)
    )
    op.add_column(
        "comments",
        sa.Column("anchor_context_before", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "comments",
        sa.Column("anchor_context_after", sa.String(length=100), nullable=True),
    )

    # Resolution tracking
    op.add_column(
        "comments",
        sa.Column(
            "is_resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column(
        "comments", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "comments", sa.Column("resolved_by", sa.String(length=36), nullable=True)
    )

    # Foreign key for resolved_by
    op.create_foreign_key(
        "fk_comments_resolved_by_user",
        "comments",
        "users",
        ["resolved_by"],
        ["id"],
        ondelete="SET NULL",
    )

    # Index for querying inline comments by position
    op.create_index(
        "idx_comments_share_anchor", "comments", ["share_id", "anchor_from"]
    )


def downgrade() -> None:
    """Remove inline comment anchor fields."""
    op.drop_index("idx_comments_share_anchor", table_name="comments")
    op.drop_constraint("fk_comments_resolved_by_user", "comments", type_="foreignkey")
    op.drop_column("comments", "resolved_by")
    op.drop_column("comments", "resolved_at")
    op.drop_column("comments", "is_resolved")
    op.drop_column("comments", "anchor_context_after")
    op.drop_column("comments", "anchor_context_before")
    op.drop_column("comments", "anchor_text")
    op.drop_column("comments", "anchor_to")
    op.drop_column("comments", "anchor_from")
