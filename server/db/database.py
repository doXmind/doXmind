"""Database configuration and models."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
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

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships - User owns all their data
    files = relationship("File", back_populates="owner", cascade="all, delete-orphan")
    conversations = relationship(
        "Conversation", back_populates="owner", cascade="all, delete-orphan"
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
    """File model with user ownership."""

    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id"), nullable=True, index=True
    )  # NULL for legacy data
    name = Column(String(255), nullable=False)
    content = Column(Text, default="")
    content_hash = Column(String(64), nullable=True)  # SHA-256 hash for change detection
    summary = Column(Text, nullable=True)  # AI-generated document summary
    is_favorite = Column(Boolean, default=False)  # Pinned/favorite status
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    owner = relationship("User", back_populates="files")
    versions = relationship("FileVersion", back_populates="file", cascade="all, delete-orphan")


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


class Message(Base):
    """Message model with full AI response storage.

    For assistant messages, stores:
    - content: The text response
    - thinking: The thinking/reasoning content (if extended thinking enabled)
    - tool_calls: List of tool calls with inputs and outputs
    - metadata: Additional metadata (model, tokens, etc.)
    """

    __tablename__ = "messages"

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
    input_tokens = Column(String(20), nullable=True)  # Token count
    output_tokens = Column(String(20), nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)  # Soft delete for statistics

    conversation = relationship("Conversation", back_populates="messages")


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

    # Vector store info
    chunk_count = Column(Integer, default=0)

    # Processing status
    status = Column(String(20), default="processing")  # processing, indexed, error
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    conversation = relationship("Conversation", back_populates="attachments")


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

    # Content strategy: "live" (default) shows current file content
    # Future: "snapshot" freezes content at share creation time
    content_mode = Column(String(20), default="live", nullable=False)

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
    )


# Engine and session setup
settings = get_settings()

# Create PostgreSQL engine
# async_database_url handles Heroku's postgres:// format conversion
engine = create_async_engine(
    settings.async_database_url,
    echo=False,  # Set to True only for SQL debugging
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=300,  # Recycle connections after 5 minutes
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
