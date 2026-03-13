"""add is_official to users and is_featured to document_shares

Revision ID: 0025_official_featured
Revises: 0024_source_database_id
Create Date: 2026-03-13
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "0025_official_featured"
down_revision = "0024_source_database_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_official", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "document_shares",
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.create_index("idx_shares_featured", "document_shares", ["is_featured", "published_at"])


def downgrade() -> None:
    op.drop_index("idx_shares_featured", table_name="document_shares")
    op.drop_column("document_shares", "is_featured")
    op.drop_column("users", "is_official")
