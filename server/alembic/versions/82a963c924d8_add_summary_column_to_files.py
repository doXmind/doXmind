"""Add summary column to files table.

Revision ID: 82a963c924d8
Revises: 0001_initial_baseline
Create Date: 2026-02-03 18:21:21.895863

Note: This migration only adds 'summary'. The 'is_favorite' column
was added in a later migration (0002_add_is_favorite_deleted_at).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "82a963c924d8"
down_revision: Union[str, Sequence[str], None] = "0001_initial_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add summary column to files table."""
    op.add_column("files", sa.Column("summary", sa.Text(), nullable=True))


def downgrade() -> None:
    """Remove summary column from files table."""
    op.drop_column("files", "summary")
