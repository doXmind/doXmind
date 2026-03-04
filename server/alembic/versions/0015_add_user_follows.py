"""add user_follows table and follow counts

Revision ID: 0015_add_user_follows
Revises: 6f91cb3162fc
Create Date: 2026-03-03

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015_add_user_follows"
down_revision: str | Sequence[str] | None = "6f91cb3162fc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create user_follows table and add follower/following counts to users."""
    op.create_table(
        "user_follows",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("follower_id", sa.String(length=36), nullable=False),
        sa.Column("following_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["follower_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["following_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_user_follows_follower_id"), "user_follows", ["follower_id"], unique=False
    )
    op.create_index(
        op.f("ix_user_follows_following_id"), "user_follows", ["following_id"], unique=False
    )
    op.create_index(
        "idx_follows_unique", "user_follows", ["follower_id", "following_id"], unique=True
    )
    op.create_index(
        "idx_follows_following_created",
        "user_follows",
        ["following_id", "created_at"],
        unique=False,
    )

    # Add denormalized follow counts to users table
    op.add_column(
        "users", sa.Column("follower_count", sa.Integer(), server_default="0", nullable=False)
    )
    op.add_column(
        "users", sa.Column("following_count", sa.Integer(), server_default="0", nullable=False)
    )


def downgrade() -> None:
    """Drop user_follows table and remove follow counts from users."""
    op.drop_column("users", "following_count")
    op.drop_column("users", "follower_count")
    op.drop_index("idx_follows_following_created", table_name="user_follows")
    op.drop_index("idx_follows_unique", table_name="user_follows")
    op.drop_index(op.f("ix_user_follows_following_id"), table_name="user_follows")
    op.drop_index(op.f("ix_user_follows_follower_id"), table_name="user_follows")
    op.drop_table("user_follows")
