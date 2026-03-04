"""add allow_fork to document_shares

Revision ID: 0017_allow_fork
Revises: 0016_add_notifications
Create Date: 2026-03-03

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0017_allow_fork"
down_revision: str | Sequence[str] | None = "0016_add_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add allow_fork column to document_shares."""
    op.add_column(
        "document_shares",
        sa.Column("allow_fork", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    """Remove allow_fork column from document_shares."""
    op.drop_column("document_shares", "allow_fork")
