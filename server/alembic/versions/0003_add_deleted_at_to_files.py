"""Add deleted_at column to files table for soft delete / trash.

Revision ID: 0003_add_deleted_at
Revises: 2112a6e62e54
Create Date: 2026-02-10
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_add_deleted_at"
down_revision: str | Sequence[str] | None = "2112a6e62e54"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add deleted_at column and index to files table."""
    op.add_column("files", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_files_deleted_at", "files", ["deleted_at"])


def downgrade() -> None:
    """Remove deleted_at column and index."""
    op.drop_index("idx_files_deleted_at", table_name="files")
    op.drop_column("files", "deleted_at")
