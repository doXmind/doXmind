"""Create api_usage table for comprehensive token tracking.

Tracks token usage for all non-chat OpenRouter API calls:
embedding, file conversion, reranking, autocomplete, edit, review, STT.

Revision ID: 0012_api_usage
Revises: 0011_add_is_byok
Create Date: 2026-02-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012_api_usage"
down_revision: str = "0011_add_is_byok"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create api_usage table."""
    op.create_table(
        "api_usage",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=True, index=True),
        sa.Column("service", sa.String(50), nullable=False, index=True),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost", sa.Float(), nullable=True),
        sa.Column("is_byok", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            index=True,
        ),
    )


def downgrade() -> None:
    """Drop api_usage table."""
    op.drop_table("api_usage")
