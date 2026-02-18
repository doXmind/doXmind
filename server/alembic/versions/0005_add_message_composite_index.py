"""Add composite index on messages(conversation_id, deleted_at).

This index optimizes the frequent query pattern in chat history loading,
which filters messages by conversation_id and deleted_at IS NULL.

Revision ID: 0005_msg_index
Revises: 0004_add_icon
Create Date: 2026-02-17
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_msg_index"
down_revision: str | Sequence[str] | None = "0004_add_icon"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add composite index for message queries."""
    op.create_index(
        "idx_messages_conversation_deleted",
        "messages",
        ["conversation_id", "deleted_at"],
    )


def downgrade() -> None:
    """Remove composite index."""
    op.drop_index("idx_messages_conversation_deleted", table_name="messages")
