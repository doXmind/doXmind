"""Database configuration and models."""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON, Boolean, Integer
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from config import get_settings


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


class File(Base):
    """File model."""
    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    content = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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
    created_at = Column(DateTime, default=datetime.utcnow)

    file = relationship("File", back_populates="versions")


class Conversation(Base):
    """Conversation model."""
    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    file_id = Column(String(36), ForeignKey("files.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    attachments = relationship("ConversationAttachment", back_populates="conversation", cascade="all, delete-orphan")


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

    created_at = Column(DateTime, default=datetime.utcnow)

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
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    conversation = relationship("Conversation", back_populates="attachments")


# Engine and session setup
settings = get_settings()

# Create engine based on database type
if settings.is_postgres:
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        pool_size=5,
        max_overflow=10
    )
else:
    # SQLite
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug
    )

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    """Get database session."""
    async with async_session() as session:
        yield session
