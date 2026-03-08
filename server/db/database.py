"""Database configuration and models."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, relationship

from config import get_settings


def utcnow() -> datetime:
    """Return current UTC time as timezone-aware datetime.

    asyncpg requires timezone-aware datetimes for PostgreSQL.
    """
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Base class for all models."""

    pass


# =============================================================================
# User Models
# =============================================================================


class User(Base):
    """User model for authentication and data ownership."""

    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), nullable=True)
    hashed_password = Column(String(255), nullable=True)  # NULL for OAuth-only users

    # OAuth fields
    oauth_provider = Column(String(50), nullable=True)  # 'google', 'github', etc.
    oauth_id = Column(String(255), nullable=True)  # Provider's user ID

    # Account status
    is_verified = Column(Boolean, default=False)  # Email verified
    is_active = Column(Boolean, default=True)  # Account enabled

    # Profile
    avatar_url = Column(String(500), nullable=True)
    avatar_frame = Column(String(50), nullable=True)  # Frame ID e.g. "golden-glow"
    bio = Column(Text, nullable=True)
    website = Column(String(500), nullable=True)
    social_links = Column(JSON, nullable=True)  # {"github": "...", "twitter": "..."}

    # Follow counts (denormalized for performance)
    follower_count = Column(Integer, default=0, nullable=False)
    following_count = Column(Integer, default=0, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships - User owns all their data
    files = relationship("File", back_populates="owner", cascade="all, delete-orphan")
    conversations = relationship(
        "Conversation", back_populates="owner", cascade="all, delete-orphan"
    )
    refresh_tokens = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("idx_users_oauth", "oauth_provider", "oauth_id"),)


class EmailVerification(Base):
    """Email verification codes for registration."""

    __tablename__ = "email_verifications"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), nullable=False, index=True)
    code = Column(String(6), nullable=False)  # 6-digit code
    expires_at = Column(DateTime(timezone=True), nullable=False)
    verified = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)  # Brute force protection
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Pending user data (stored until verification)
    pending_username = Column(String(100), nullable=True)
    pending_hashed_password = Column(String(255), nullable=True)


class RefreshToken(Base):
    """Refresh token storage for dual-token authentication.

    Stores long-lived refresh tokens in database with device tracking.
    Tokens are hashed (SHA-256) for security - plain tokens never stored.
    Supports token rotation: each refresh issues new token and revokes old.
    """

    __tablename__ = "refresh_tokens"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash = Column(String(64), unique=True, nullable=False, index=True)

    # Device tracking for session management
    device_fingerprint = Column(String(255), nullable=True)
    ip_address = Column(String(45), nullable=True)  # IPv6-compatible (max 45 chars)
    user_agent = Column(String(500), nullable=True)
    device_name = Column(
        String(100), nullable=True
    )  # Parsed device name (e.g., "Chrome on Windows")

    # Token lifecycle
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    last_used_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Revocation tracking
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    is_revoked = Column(Boolean, default=False, nullable=False, index=True)

    # Relationship
    user = relationship("User", back_populates="refresh_tokens")

    __table_args__ = (
        Index("idx_refresh_tokens_user_revoked", "user_id", "is_revoked"),
        Index("idx_refresh_tokens_user_device", "user_id", "device_fingerprint"),
        Index("idx_refresh_tokens_expires", "expires_at"),
    )


class PasswordReset(Base):
    """Password reset tokens."""

    __tablename__ = "password_resets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    token = Column(String(255), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)


# =============================================================================
# Content Models
# =============================================================================


class File(Base):
    """File model with user ownership and folder support."""

    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id"), nullable=True, index=True
    )  # NULL for legacy data
    name = Column(String(255), nullable=False)
    content = Column(Text, default="")
    content_hash = Column(String(64), nullable=True)  # SHA-256 hash for change detection
    content_markdown = Column(Text, nullable=True)  # Cached markdown for AI consumption
    summary = Column(Text, nullable=True)  # AI-generated document summary
    is_favorite = Column(Boolean, default=False)  # Pinned/favorite status
    icon = Column(String(10), nullable=True)  # Document emoji icon
    presentation_simplified = Column(
        Text, nullable=True
    )  # AI-simplified presentation content (JSON)

    # Folder hierarchy support (single-level only)
    is_folder = Column(Boolean, default=False, nullable=False, index=True)
    parent_id = Column(
        String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=True, index=True
    )  # NULL = root level; folders must have parent_id=NULL (single-level constraint)
    position = Column(Integer, default=0)  # For custom ordering within folders

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)  # Soft delete for trash

    # Relationships
    owner = relationship("User", back_populates="files")
    versions = relationship("FileVersion", back_populates="file", cascade="all, delete-orphan")
    parent = relationship("File", remote_side=[id], backref="children")

    # Composite indexes for efficient folder queries
    __table_args__ = (
        Index("idx_files_user_parent", "user_id", "parent_id"),
        Index("idx_files_parent_position", "parent_id", "position"),
        Index("idx_files_deleted_at", "deleted_at"),
    )


class FileVersion(Base):
    """File version model for history tracking."""

    __tablename__ = "file_versions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    file_id = Column(String(36), ForeignKey("files.id"), nullable=False)
    content = Column(Text, nullable=False)
    diff = Column(Text)  # JSON format diff
    edit_type = Column(String(50))  # "manual" | "ai_edit" | "ai_quick_edit"
    summary = Column(String(500))  # AI-generated change summary
    created_at = Column(DateTime(timezone=True), default=utcnow)

    file = relationship("File", back_populates="versions")


class Conversation(Base):
    """Conversation model with user ownership.

    Note: file_id is NOT a foreign key to files table. It's an arbitrary string
    identifier used to group conversations by document/context. This allows
    conversations to exist for "files" that haven't been saved to the database yet.
    """

    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id"), nullable=True, index=True
    )  # NULL for legacy data
    file_id = Column(
        String(255), nullable=True, index=True
    )  # Arbitrary string identifier, NOT a FK
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    owner = relationship("User", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    attachments = relationship(
        "ConversationAttachment", back_populates="conversation", cascade="all, delete-orphan"
    )
    data_files = relationship(
        "ConversationDataFile", back_populates="conversation", cascade="all, delete-orphan"
    )


class Message(Base):
    """Message model with full AI response storage.

    For assistant messages, stores:
    - content: The text response
    - thinking: The thinking/reasoning content (if extended thinking enabled)
    - tool_calls: List of tool calls with inputs and outputs
    - metadata: Additional metadata (model, tokens, etc.)
    """

    __tablename__ = "messages"
    __table_args__ = (Index("idx_messages_conversation_deleted", "conversation_id", "deleted_at"),)

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String(36), ForeignKey("conversations.id"))
    role = Column(String(20))  # "user" | "assistant"
    content = Column(Text)  # Main text content

    # User message specific fields
    contexts = Column(JSON, nullable=True)  # Attached images and selected text: [{type, ...}]

    # AI response specific fields
    thinking = Column(Text, nullable=True)  # Extended thinking content
    tool_calls = Column(JSON, nullable=True)  # List of tool calls: [{name, input, output, success}]
    edits = Column(JSON, nullable=True)  # List of edit operations applied

    # Metadata
    model = Column(String(100), nullable=True)  # Model used for generation
    input_tokens = Column(Integer, nullable=True)  # Input (prompt) token count
    output_tokens = Column(Integer, nullable=True)  # Output (completion) token count
    cost = Column(Float, nullable=True)  # Cost in USD from OpenRouter
    is_byok = Column(Boolean, default=False)  # True if user's own API key was used

    created_at = Column(DateTime(timezone=True), default=utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)  # Soft delete for statistics

    conversation = relationship("Conversation", back_populates="messages")


class ApiUsage(Base):
    """API usage tracking for non-chat OpenRouter calls.

    Tracks token usage for: file conversion, autocomplete, quick edit,
    custom edit, review, KB chat, STT.
    """

    __tablename__ = "api_usage"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), nullable=True, index=True)
    service = Column(String(50), nullable=False, index=True)
    model = Column(String(100), nullable=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    cost = Column(Float, nullable=True)
    is_byok = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)


class ConversationAttachment(Base):
    """Knowledge base attachment for a conversation.

    Stores uploaded documents (PDF, DOCX, PPTX) that are attached to a conversation
    and available to the AI through search/read tools.
    """

    __tablename__ = "conversation_attachments"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String(36), ForeignKey("conversations.id"), nullable=False)

    # File metadata
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=False)  # pdf, docx, pptx
    file_size = Column(Integer, nullable=False)  # bytes

    # Extracted content
    extracted_text = Column(Text, nullable=True)  # Markdown-converted text

    # Content info
    chunk_count = Column(Integer, default=0)

    # Processing status
    status = Column(String(20), default="processing")  # processing, indexed, error
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    conversation = relationship("Conversation", back_populates="attachments")


class ConversationDataFile(Base):
    """Data file for code execution analysis.

    Stores uploaded data files (CSV, XLSX, JSON, TXT, images) that are passed
    to Claude's code execution sandbox for data analysis and visualization.

    Unlike ConversationAttachment (KB files), these are not used for text search.
    Instead, they are directly passed to the API as base64 content.

    Upload strategy:
    - Small files (<500KB): stored as base64, sent inline (no Files API)
    - Large files: uploaded to Claude Files API asynchronously after local upload
    """

    __tablename__ = "conversation_data_files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String(36), ForeignKey("conversations.id"), nullable=False)

    # File metadata
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=False)  # csv, xlsx, json, txt, png, jpg
    file_size = Column(Integer, nullable=False)  # bytes
    mime_type = Column(String(100), nullable=True)

    # Temporary storage path (files are stored temporarily)
    storage_path = Column(String(500), nullable=True)

    # Preview data for spreadsheets (first 5 rows as JSON)
    preview_data = Column(JSON, nullable=True)
    column_names = Column(JSON, nullable=True)
    row_count = Column(Integer, default=0)

    # Status (local upload)
    status = Column(String(20), default="ready")  # uploading, ready, error
    error_message = Column(Text, nullable=True)

    # Claude Files API integration
    # For large files, we upload to Claude asynchronously after local upload
    claude_file_id = Column(String(100), nullable=True)  # Anthropic file ID
    claude_upload_status = Column(
        String(20), default="pending"
    )  # pending, uploading, ready, error, skipped
    claude_upload_error = Column(Text, nullable=True)

    # Content hash for deduplication (SHA-256)
    content_hash = Column(String(64), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    conversation = relationship("Conversation", back_populates="data_files")


# =============================================================================
# Telemetry Models
# =============================================================================


class TelemetryEvent(Base):
    """Telemetry event for user behavior tracking.

    Stores events for:
    1. RLHF training data (chosen/rejected pairs)
    2. Product analytics (aggregate statistics)
    """

    __tablename__ = "telemetry_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id"), nullable=True, index=True
    )  # Nullable for anonymous
    event_type = Column(String(50), nullable=False, index=True)
    event_data = Column(JSON, nullable=False)  # Full event payload
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)

    # RLHF training fields (structured for easy export)
    chosen_content = Column(Text, nullable=True)  # Content user preferred
    rejected_content = Column(Text, nullable=True)  # Content user rejected
    context = Column(Text, nullable=True)  # Context/prompt

    __table_args__ = (
        Index("idx_telemetry_user_type", "user_id", "event_type"),
        Index("idx_telemetry_created", "created_at"),
    )


class UserTelemetrySettings(Base):
    """User's telemetry preferences.

    Controls what data is collected for each user.
    Default: all enabled (product improvement enabled).
    """

    __tablename__ = "user_telemetry_settings"

    user_id = Column(String(36), ForeignKey("users.id"), primary_key=True)
    product_improvement_enabled = Column(Boolean, default=True)
    collect_edit_feedback = Column(Boolean, default=True)
    collect_chat_feedback = Column(Boolean, default=True)
    collect_autocomplete_stats = Column(Boolean, default=True)
    collect_usage_stats = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class UserAPISettings(Base):
    """User's API key and model preferences.

    Allows users to use their own Anthropic API key and select models.
    API keys are encrypted using Fernet symmetric encryption.
    """

    __tablename__ = "user_api_settings"

    user_id = Column(String(36), ForeignKey("users.id"), primary_key=True)
    encrypted_anthropic_key = Column(Text, nullable=True)  # Fernet encrypted
    preferred_model = Column(String(100), default="claude-sonnet-4-5-20250929")
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# =============================================================================
# Document Sharing Models
# =============================================================================


class DocumentShare(Base):
    """Document share model for public read-only access."""

    __tablename__ = "document_shares"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Relationships
    file_id = Column(
        String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Share token - cryptographically secure, URL-safe (43 characters, ~256 bits entropy)
    share_token = Column(String(64), unique=True, nullable=False, index=True)

    # Share settings
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    allow_fork = Column(Boolean, default=True, nullable=False)

    # Content strategy: "live" (default) shows current file content
    # Future: "snapshot" freezes content at share creation time
    content_mode = Column(String(20), default="live", nullable=False)

    # Visibility: "public" = discoverable/community, "private" = invite-only
    visibility = Column(String(20), default="public", nullable=False, index=True)

    # Community publishing
    is_published = Column(Boolean, default=False, nullable=False, index=True)
    title = Column(String(255), nullable=True)  # Display title for community
    description = Column(Text, nullable=True)  # Short description for discovery
    tags = Column(JSON, nullable=True)  # ["writing", "tech", "tutorial"]
    published_at = Column(DateTime(timezone=True), nullable=True)
    fork_count = Column(Integer, default=0, nullable=False)
    bookmark_count = Column(Integer, default=0, nullable=False)
    comment_count = Column(Integer, default=0, nullable=False)
    reaction_count = Column(Integer, default=0, nullable=False)

    # Analytics
    view_count = Column(Integer, default=0, nullable=False)
    last_viewed_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    file = relationship("File", backref="shares")
    owner = relationship("User", backref="document_shares")

    __table_args__ = (
        Index("idx_shares_active_expires", "is_active", "expires_at"),
        Index("idx_shares_file_active", "file_id", "is_active"),
        Index("idx_shares_published", "is_published", "published_at"),
        Index("idx_shares_published_popular", "is_published", "fork_count", "bookmark_count"),
    )


# =============================================================================
# Community Models
# =============================================================================


class Fork(Base):
    """Fork (转存) tracks when a user copies a shared document to their own space."""

    __tablename__ = "forks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_share_id = Column(
        String(36),
        ForeignKey("document_shares.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_file_id = Column(
        String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    forked_file_id = Column(
        String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    source_content_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    source_share = relationship("DocumentShare", backref="forks")
    source_file = relationship("File", foreign_keys=[source_file_id])
    owner = relationship("User", backref="forks")
    forked_file = relationship("File", foreign_keys=[forked_file_id])

    __table_args__ = (Index("idx_forks_user_source", "user_id", "source_share_id", unique=True),)


class Bookmark(Base):
    """Bookmark allows users to save shared documents for later access."""

    __tablename__ = "bookmarks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    share_id = Column(
        String(36),
        ForeignKey("document_shares.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    owner = relationship("User", backref="bookmarks")
    share = relationship("DocumentShare", backref="bookmarks_rel")

    __table_args__ = (Index("idx_bookmarks_user_share", "user_id", "share_id", unique=True),)


class Comment(Base):
    """Comment on a published/shared document."""

    __tablename__ = "comments"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    share_id = Column(
        String(36),
        ForeignKey("document_shares.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id = Column(
        String(36), ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    content = Column(Text, nullable=False)
    mentions = Column(JSON, nullable=True)  # ["user_id_1", "user_id_2"]
    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    share = relationship("DocumentShare", backref="comments")
    author = relationship("User", backref="comments")
    parent = relationship("Comment", remote_side=[id], backref="replies")

    __table_args__ = (Index("idx_comments_share_created", "share_id", "created_at"),)


class CommentReaction(Base):
    """Emoji reaction on a comment."""

    __tablename__ = "comment_reactions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    comment_id = Column(
        String(36), ForeignKey("comments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    emoji = Column(String(10), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    comment = relationship("Comment", backref="reactions")
    owner = relationship("User")

    __table_args__ = (
        Index("idx_reactions_comment_user_emoji", "comment_id", "user_id", "emoji", unique=True),
    )


class ShareReaction(Base):
    """Emoji reaction on a shared community item."""

    __tablename__ = "share_reactions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    share_id = Column(
        String(36),
        ForeignKey("document_shares.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    emoji = Column(String(10), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    share = relationship("DocumentShare", backref="reactions")
    owner = relationship("User")

    __table_args__ = (
        Index(
            "idx_share_reactions_share_user_emoji",
            "share_id",
            "user_id",
            "emoji",
            unique=True,
        ),
    )


class ShareView(Base):
    """Per-user view tracking for shared community items."""

    __tablename__ = "share_views"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    share_id = Column(
        String(36),
        ForeignKey("document_shares.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    share = relationship("DocumentShare", backref="share_views")
    viewer = relationship("User")

    __table_args__ = (
        Index("idx_share_views_user_share", "user_id", "share_id", unique=True),
        Index("idx_share_views_user_created", "user_id", "created_at"),
    )


class UserFollow(Base):
    """Follow relationship between users."""

    __tablename__ = "user_follows"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    follower_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    following_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    follower = relationship("User", foreign_keys=[follower_id])
    following = relationship("User", foreign_keys=[following_id])

    __table_args__ = (
        Index("idx_follows_unique", "follower_id", "following_id", unique=True),
        Index("idx_follows_following_created", "following_id", "created_at"),
    )


class ShareInvite(Base):
    """Invite granting a specific user access to a private share."""

    __tablename__ = "share_invites"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    share_id = Column(
        String(36),
        ForeignKey("document_shares.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invited_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    share = relationship("DocumentShare", backref="invites")
    user = relationship("User", foreign_keys=[user_id])
    inviter = relationship("User", foreign_keys=[invited_by])

    __table_args__ = (Index("idx_share_invites_share_user", "share_id", "user_id", unique=True),)


class Notification(Base):
    """In-app notification for a user."""

    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type = Column(String(32), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(String(500), nullable=False)
    link = Column(String(500), nullable=True)
    actor_id = Column(String(36), nullable=True)
    actor_name = Column(String(100), nullable=True)
    actor_avatar = Column(String(500), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (Index("idx_notifications_user_unread", "user_id", "is_read", "created_at"),)


# =============================================================================
# Billing / Subscription Models
# =============================================================================


class UserSubscription(Base):
    """User subscription and billing information."""

    __tablename__ = "user_subscriptions"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    # Stripe integration
    stripe_customer_id = Column(String(255), unique=True, nullable=True, index=True)
    stripe_subscription_id = Column(String(255), unique=True, nullable=True, index=True)

    # Plan info
    plan = Column(String(20), default="free", nullable=False)  # free | pro | max
    is_early_bird = Column(Boolean, default=False, nullable=False)

    # Subscription status
    status = Column(String(20), default="active", nullable=False)
    # active | past_due | canceled | incomplete

    # Billing cycle (from Stripe)
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    canceled_at = Column(DateTime(timezone=True), nullable=True)

    # Storage quota
    storage_used_bytes = Column(BigInteger, default=0, nullable=False)
    storage_limit_bytes = Column(BigInteger, default=100 * 1024 * 1024, nullable=False)  # 100 MB

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationship
    user = relationship("User", backref="subscription", uselist=False)


class UserCredits(Base):
    """User credit balance for usage-based billing."""

    __tablename__ = "user_credits"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    # Credit balance (internal units; display = internal * 10)
    credits_remaining = Column(Integer, default=600, nullable=False)
    credits_limit = Column(Integer, default=600, nullable=False)  # Per-period limit

    # Period tracking
    period_start = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    period_end = Column(DateTime(timezone=True), nullable=False)

    # Usage tracking
    credits_used_this_period = Column(Integer, default=0, nullable=False)

    # Timestamps
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationship
    user = relationship("User", backref="credits", uselist=False)


class CreditTransaction(Base):
    """Audit log of credit deductions and grants."""

    __tablename__ = "credit_transactions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Transaction info
    amount = Column(Integer, nullable=False)  # Negative=deduction, positive=grant/reset
    balance_after = Column(Integer, nullable=False)
    transaction_type = Column(String(20), nullable=False)
    # deduction | period_reset | plan_change | manual_adjustment

    # Context
    service = Column(String(50), nullable=True)  # chat, autocomplete, web_search, etc.
    description = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Auto-sanitize content on all ORM write paths (update_file, restore_version,
# import, fork, community seed, etc.) so we never store problematic bytes.
# Core INSERT paths (create_file) are handled explicitly in their call sites.
# ---------------------------------------------------------------------------
from sqlalchemy import event as _sa_event  # noqa: E402

from services.content_sanitizer import sanitize_content as _sanitize  # noqa: E402


def _sanitize_content_columns(mapper, connection, target):
    """Sanitize all text content columns before INSERT/UPDATE."""
    if hasattr(target, "content") and target.content is not None:
        target.content = _sanitize(target.content)
    if hasattr(target, "content_markdown") and target.content_markdown is not None:
        target.content_markdown = _sanitize(target.content_markdown)


for _model in (File, FileVersion):
    _sa_event.listen(_model, "before_insert", _sanitize_content_columns)
    _sa_event.listen(_model, "before_update", _sanitize_content_columns)


# Engine and session setup
settings = get_settings()

# Create PostgreSQL engine
# async_database_url handles Heroku's postgres:// format conversion
engine = create_async_engine(
    settings.async_database_url,
    echo=False,  # Set to True only for SQL debugging
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=settings.db_pool_recycle,
    pool_timeout=settings.db_pool_timeout,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db(max_retries: int = 5, retry_delay: float = 2.0):
    """Initialize database tables.

    Handles race conditions when multiple workers start simultaneously
    (e.g., Heroku with WEB_CONCURRENCY > 1) by catching 'table already exists' errors.

    Also retries on connection failures to handle Docker container startup timing.
    """
    import asyncio
    import logging

    logger = logging.getLogger(__name__)

    for attempt in range(max_retries):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                # Create safe_substr: timeout-protected substr for encoding resilience
                await conn.execute(
                    text("""
                    CREATE OR REPLACE FUNCTION safe_substr(t text, start_pos int, len int)
                    RETURNS text AS $$
                    DECLARE
                        old_timeout text;
                        result text;
                    BEGIN
                        old_timeout := current_setting('statement_timeout');
                        PERFORM set_config('statement_timeout', '2000', true);
                        BEGIN
                            result := substr(t, start_pos, len);
                            PERFORM set_config('statement_timeout', old_timeout, true);
                            RETURN result;
                        EXCEPTION WHEN OTHERS THEN
                            PERFORM set_config('statement_timeout', old_timeout, true);
                            RETURN '';
                        END;
                    END;
                    $$ LANGUAGE plpgsql;
                    """)
                )
            logger.info("Database tables initialized successfully")
            return
        except Exception as e:
            # Ignore "table already exists" errors from race conditions
            if "already exists" in str(e):
                logger.info("Database tables already exist")
                return

            # Retry on connection errors
            if attempt < max_retries - 1:
                logger.warning(
                    f"Database connection attempt {attempt + 1}/{max_retries} failed: {e}. "
                    f"Retrying in {retry_delay}s..."
                )
                await asyncio.sleep(retry_delay)
            else:
                logger.error(f"Failed to connect to database after {max_retries} attempts")
                raise


async def get_db() -> AsyncSession:
    """Get database session."""
    async with async_session() as session:
        yield session
