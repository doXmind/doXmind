"""add content_markdown cache column to files

Revision ID: 0014_content_markdown
Revises: 0013_drop_vectors
Create Date: 2026-02-28

Adds a nullable content_markdown column to the files table.
This caches the markdown representation of HTML content so the AI
reads pre-computed markdown with zero conversion at chat time.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014_content_markdown"
down_revision: str | Sequence[str] | None = "0013_drop_vectors"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("files", sa.Column("content_markdown", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("files", "content_markdown")
