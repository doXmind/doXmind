"""Initial baseline migration.

This migration represents the existing database schema.
For new databases: creates all tables.
For existing databases: use 'alembic stamp head' to mark as current.

Revision ID: 0001_initial_baseline
Revises: None
Create Date: 2026-02-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial_baseline"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create all database tables."""
    # Users table
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False, index=True),
        sa.Column("username", sa.String(100), nullable=True),
        sa.Column("hashed_password", sa.String(255), nullable=True),
        sa.Column("oauth_provider", sa.String(50), nullable=True),
        sa.Column("oauth_id", sa.String(255), nullable=True),
        sa.Column("is_verified", sa.Boolean(), default=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("avatar_url", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_users_oauth", "users", ["oauth_provider", "oauth_id"])

    # Email verifications table
    op.create_table(
        "email_verifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, index=True),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verified", sa.Boolean(), default=False),
        sa.Column("attempts", sa.Integer(), default=0),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("pending_username", sa.String(100), nullable=True),
        sa.Column("pending_hashed_password", sa.String(255), nullable=True),
    )

    # Password resets table
    op.create_table(
        "password_resets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token", sa.String(255), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Files table
    op.create_table(
        "files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), default=""),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )

    # File versions table
    op.create_table(
        "file_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("diff", sa.Text(), nullable=True),
        sa.Column("edit_type", sa.String(50), nullable=True),
        sa.Column("summary", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Conversations table
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("file_id", sa.String(255), nullable=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Messages table
    op.create_table(
        "messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("conversation_id", sa.String(36), sa.ForeignKey("conversations.id")),
        sa.Column("role", sa.String(20)),
        sa.Column("content", sa.Text()),
        sa.Column("contexts", sa.JSON(), nullable=True),
        sa.Column("thinking", sa.Text(), nullable=True),
        sa.Column("tool_calls", sa.JSON(), nullable=True),
        sa.Column("edits", sa.JSON(), nullable=True),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("input_tokens", sa.String(20), nullable=True),
        sa.Column("output_tokens", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Conversation attachments table
    op.create_table(
        "conversation_attachments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(20), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("chunk_count", sa.Integer(), default=0),
        sa.Column("status", sa.String(20), default="processing"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Conversation data files table
    op.create_table(
        "conversation_data_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(20), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("storage_path", sa.String(500), nullable=True),
        sa.Column("preview_data", sa.JSON(), nullable=True),
        sa.Column("column_names", sa.JSON(), nullable=True),
        sa.Column("row_count", sa.Integer(), default=0),
        sa.Column("status", sa.String(20), default="ready"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("claude_file_id", sa.String(100), nullable=True),
        sa.Column("claude_upload_status", sa.String(20), default="pending"),
        sa.Column("claude_upload_error", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Telemetry events table
    op.create_table(
        "telemetry_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("event_type", sa.String(50), nullable=False, index=True),
        sa.Column("event_data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), index=True),
        sa.Column("chosen_content", sa.Text(), nullable=True),
        sa.Column("rejected_content", sa.Text(), nullable=True),
        sa.Column("context", sa.Text(), nullable=True),
    )
    op.create_index("idx_telemetry_user_type", "telemetry_events", ["user_id", "event_type"])
    op.create_index("idx_telemetry_created", "telemetry_events", ["created_at"])

    # User telemetry settings table
    op.create_table(
        "user_telemetry_settings",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("product_improvement_enabled", sa.Boolean(), default=True),
        sa.Column("collect_edit_feedback", sa.Boolean(), default=True),
        sa.Column("collect_chat_feedback", sa.Boolean(), default=True),
        sa.Column("collect_autocomplete_stats", sa.Boolean(), default=True),
        sa.Column("collect_usage_stats", sa.Boolean(), default=True),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )

    # Document shares table
    op.create_table(
        "document_shares",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "file_id",
            sa.String(36),
            sa.ForeignKey("files.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("share_token", sa.String(64), unique=True, nullable=False, index=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True, index=True),
        sa.Column("is_active", sa.Boolean(), default=True, nullable=False, index=True),
        sa.Column("content_mode", sa.String(20), default="live", nullable=False),
        sa.Column("view_count", sa.Integer(), default=0, nullable=False),
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_shares_active_expires", "document_shares", ["is_active", "expires_at"])
    op.create_index("idx_shares_file_active", "document_shares", ["file_id", "is_active"])


def downgrade() -> None:
    """Drop all database tables."""
    op.drop_table("document_shares")
    op.drop_table("user_telemetry_settings")
    op.drop_index("idx_telemetry_created", table_name="telemetry_events")
    op.drop_index("idx_telemetry_user_type", table_name="telemetry_events")
    op.drop_table("telemetry_events")
    op.drop_table("conversation_data_files")
    op.drop_table("conversation_attachments")
    op.drop_table("messages")
    op.drop_table("conversations")
    op.drop_table("file_versions")
    op.drop_table("files")
    op.drop_table("password_resets")
    op.drop_table("email_verifications")
    op.drop_index("idx_users_oauth", table_name="users")
    op.drop_table("users")
