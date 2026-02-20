"""Add visibility column to document_shares and create share_invites table.

Public shares are auto-published to community. Private shares are invite-only.

Revision ID: 0009_share_visibility
Revises: 0008_community_tables
Create Date: 2026-02-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009_share_visibility"
down_revision: str = "0008_community_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add visibility column to document_shares
    op.add_column(
        "document_shares",
        sa.Column("visibility", sa.String(20), nullable=False, server_default="public"),
    )
    op.create_index("ix_document_shares_visibility", "document_shares", ["visibility"])

    # 2. Create share_invites table (skip if already exists from model metadata)
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'share_invites')"
        )
    )
    table_exists = result.scalar()

    if not table_exists:
        op.create_table(
            "share_invites",
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
                "invited_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_share_invites_share_id", "share_invites", ["share_id"])
        op.create_index("ix_share_invites_user_id", "share_invites", ["user_id"])
        op.create_index(
            "idx_share_invites_share_user",
            "share_invites",
            ["share_id", "user_id"],
            unique=True,
        )

    # 3. Data migration: all existing shares are public (backward compatible)
    # The server_default already handles this, so no explicit UPDATE needed.


def downgrade() -> None:
    op.drop_table("share_invites")
    op.drop_index("ix_document_shares_visibility", table_name="document_shares")
    op.drop_column("document_shares", "visibility")
