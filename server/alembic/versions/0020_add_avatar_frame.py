"""add avatar_frame column to users

Revision ID: 0020_avatar_frame
Revises: 0019_billing
Create Date: 2026-03-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020_avatar_frame"
down_revision: str | Sequence[str] | None = "0019_billing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add avatar_frame column to users table."""
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    columns = [c["name"] for c in inspector.get_columns("users")]

    if "avatar_frame" not in columns:
        op.add_column("users", sa.Column("avatar_frame", sa.String(50), nullable=True))


def downgrade() -> None:
    """Remove avatar_frame column from users table."""
    op.drop_column("users", "avatar_frame")
