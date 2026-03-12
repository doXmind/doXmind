"""add source_database_id to conversation_data_files

Revision ID: 0024
Revises: 0023
Create Date: 2026-03-11
"""

from alembic import op  # noqa: I001
import sqlalchemy as sa

# revision identifiers
revision = "0024_source_database_id"
down_revision = "0023_database_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_data_files",
        sa.Column("source_database_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_conversation_data_files_source_database_id",
        "conversation_data_files",
        ["source_database_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_conversation_data_files_source_database_id",
        table_name="conversation_data_files",
    )
    op.drop_column("conversation_data_files", "source_database_id")
