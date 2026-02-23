"""add presentation_simplified column

Revision ID: 0b0afee66952
Revises: 0012_api_usage
Create Date: 2026-02-22 23:55:06.335296

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0b0afee66952"
down_revision: str | Sequence[str] | None = "0012_api_usage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add presentation_simplified column to files table."""
    op.add_column("files", sa.Column("presentation_simplified", sa.Text(), nullable=True))


def downgrade() -> None:
    """Remove presentation_simplified column from files table."""
    op.drop_column("files", "presentation_simplified")
