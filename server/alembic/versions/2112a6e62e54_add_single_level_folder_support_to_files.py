"""add single-level folder support to files

Revision ID: 2112a6e62e54
Revises: 0002_add_is_favorite
Create Date: 2026-02-09 14:41:59.538542

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2112a6e62e54"
down_revision: str | Sequence[str] | None = "0002_add_is_favorite"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: Add folder hierarchy support to files table."""
    # Add folder hierarchy columns
    op.add_column(
        "files", sa.Column("is_folder", sa.Boolean(), nullable=False, server_default="false")
    )
    op.add_column("files", sa.Column("parent_id", sa.String(length=36), nullable=True))
    op.add_column("files", sa.Column("position", sa.Integer(), nullable=False, server_default="0"))

    # Create indexes for efficient folder queries
    op.create_index("idx_files_parent_position", "files", ["parent_id", "position"], unique=False)
    op.create_index("idx_files_user_parent", "files", ["user_id", "parent_id"], unique=False)
    op.create_index(op.f("ix_files_is_folder"), "files", ["is_folder"], unique=False)
    op.create_index(op.f("ix_files_parent_id"), "files", ["parent_id"], unique=False)

    # Add self-referential foreign key with CASCADE delete
    op.create_foreign_key(
        "fk_files_parent_id", "files", "files", ["parent_id"], ["id"], ondelete="CASCADE"
    )


def downgrade() -> None:
    """Downgrade schema: Remove folder hierarchy support from files table."""
    # Drop foreign key constraint
    op.drop_constraint("fk_files_parent_id", "files", type_="foreignkey")

    # Drop indexes
    op.drop_index(op.f("ix_files_parent_id"), table_name="files")
    op.drop_index(op.f("ix_files_is_folder"), table_name="files")
    op.drop_index("idx_files_user_parent", table_name="files")
    op.drop_index("idx_files_parent_position", table_name="files")

    # Drop columns
    op.drop_column("files", "position")
    op.drop_column("files", "parent_id")
    op.drop_column("files", "is_folder")
