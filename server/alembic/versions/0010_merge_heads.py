"""Merge multiple head revisions.

Revision ID: 0010_merge_heads
Revises: 0009_share_visibility, 0009_visibility_invites
Create Date: 2026-02-20
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0010_merge_heads"
down_revision: str | Sequence[str] | None = ("0009_share_visibility", "0009_visibility_invites")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Merge migration - no operations needed."""
    pass


def downgrade() -> None:
    """Merge migration - no operations needed."""
    pass
