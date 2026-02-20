"""Create community tables: forks, bookmarks, comments, comment_reactions.

Revision ID: 0008_community_tables
Revises: 0007_community_shares
Create Date: 2026-02-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_community_tables"
down_revision: str | Sequence[str] | None = "0007_community_shares"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create forks, bookmarks, comments, comment_reactions tables."""
    # Forks table
    op.create_table(
        "forks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "source_share_id",
            sa.String(36),
            sa.ForeignKey("document_shares.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_file_id",
            sa.String(36),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "forked_file_id",
            sa.String(36),
            sa.ForeignKey("files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_content_hash", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_forks_source_share_id", "forks", ["source_share_id"])
    op.create_index("ix_forks_source_file_id", "forks", ["source_file_id"])
    op.create_index("ix_forks_user_id", "forks", ["user_id"])
    op.create_index("ix_forks_forked_file_id", "forks", ["forked_file_id"])
    op.create_index("idx_forks_user_source", "forks", ["user_id", "source_share_id"], unique=True)

    # Bookmarks table
    op.create_table(
        "bookmarks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "share_id",
            sa.String(36),
            sa.ForeignKey("document_shares.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_bookmarks_user_id", "bookmarks", ["user_id"])
    op.create_index("ix_bookmarks_share_id", "bookmarks", ["share_id"])
    op.create_index("idx_bookmarks_user_share", "bookmarks", ["user_id", "share_id"], unique=True)

    # Comments table
    op.create_table(
        "comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "share_id",
            sa.String(36),
            sa.ForeignKey("document_shares.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.String(36),
            sa.ForeignKey("comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("mentions", sa.JSON(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_comments_share_id", "comments", ["share_id"])
    op.create_index("ix_comments_user_id", "comments", ["user_id"])
    op.create_index("ix_comments_parent_id", "comments", ["parent_id"])
    op.create_index("idx_comments_share_created", "comments", ["share_id", "created_at"])

    # Comment reactions table
    op.create_table(
        "comment_reactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "comment_id",
            sa.String(36),
            sa.ForeignKey("comments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("emoji", sa.String(10), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_reactions_comment_id", "comment_reactions", ["comment_id"])
    op.create_index("ix_reactions_user_id", "comment_reactions", ["user_id"])
    op.create_index(
        "idx_reactions_comment_user_emoji",
        "comment_reactions",
        ["comment_id", "user_id", "emoji"],
        unique=True,
    )


def downgrade() -> None:
    """Drop community tables."""
    op.drop_table("comment_reactions")
    op.drop_table("comments")
    op.drop_table("bookmarks")
    op.drop_table("forks")
