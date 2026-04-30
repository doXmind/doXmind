"""Database configuration and models — single-user local SQLite edition."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, relationship

from config import get_settings


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


# =============================================================================
# Files & Versions
# =============================================================================


class File(Base):
    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    content = Column(Text, default="")
    content_hash = Column(String(64), nullable=True)
    content_markdown = Column(Text, nullable=True)
    is_favorite = Column(Boolean, default=False)
    icon = Column(String(10), nullable=True)

    cover_image_url = Column(Text, nullable=True)
    cover_position = Column(Float, default=0.5)

    is_folder = Column(Boolean, default=False, nullable=False, index=True)
    parent_id = Column(
        String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=True, index=True
    )
    position = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    versions = relationship("FileVersion", back_populates="file", cascade="all, delete-orphan")
    parent = relationship("File", remote_side=[id], backref="children")

    __table_args__ = (
        Index("idx_files_parent_position", "parent_id", "position"),
        Index("idx_files_deleted_at", "deleted_at"),
    )


class FileVersion(Base):
    __tablename__ = "file_versions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    file_id = Column(String(36), ForeignKey("files.id"), nullable=False)
    content = Column(Text, nullable=False)
    edit_type = Column(String(50))
    summary = Column(String(500))
    created_at = Column(DateTime(timezone=True), default=utcnow)

    file = relationship("File", back_populates="versions")


# =============================================================================
# Database blocks (Notion-style inline tables)
# =============================================================================


class DatabaseBlock(Base):
    __tablename__ = "database_blocks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(255), nullable=False, default="Untitled Database")
    icon = Column(String(10), nullable=True)
    properties_schema = Column(JSON, nullable=False, default=list)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    rows = relationship(
        "DatabaseRow",
        back_populates="database",
        cascade="all, delete-orphan",
        order_by="DatabaseRow.position",
    )
    views = relationship(
        "DatabaseView",
        back_populates="database",
        cascade="all, delete-orphan",
        order_by="DatabaseView.position",
    )


class DatabaseRow(Base):
    __tablename__ = "database_rows"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    database_id = Column(
        String(36),
        ForeignKey("database_blocks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    properties = Column(JSON, nullable=False, default=dict)
    position = Column(Integer, default=0)
    page_file_id = Column(
        String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    database = relationship("DatabaseBlock", back_populates="rows")
    page_file = relationship("File")

    __table_args__ = (Index("idx_db_rows_database_position", "database_id", "position"),)


class DatabaseView(Base):
    __tablename__ = "database_views"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    database_id = Column(
        String(36),
        ForeignKey("database_blocks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False, default="Table View")
    type = Column(String(20), nullable=False, default="table")
    config = Column(JSON, nullable=False, default=dict)
    position = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    database = relationship("DatabaseBlock", back_populates="views")

    __table_args__ = (Index("idx_db_views_database_position", "database_id", "position"),)


# ---------------------------------------------------------------------------
# Auto-sanitize content on ORM write paths so we never store problematic bytes.
# ---------------------------------------------------------------------------
from sqlalchemy import event as _sa_event  # noqa: E402

from services.content_sanitizer import sanitize_content as _sanitize  # noqa: E402


def _sanitize_content_columns(mapper, connection, target):
    if hasattr(target, "content") and target.content is not None:
        target.content = _sanitize(target.content)
    if hasattr(target, "content_markdown") and target.content_markdown is not None:
        target.content_markdown = _sanitize(target.content_markdown)


for _model in (File, FileVersion):
    _sa_event.listen(_model, "before_insert", _sanitize_content_columns)
    _sa_event.listen(_model, "before_update", _sanitize_content_columns)


# =============================================================================
# Engine / session
# =============================================================================
settings = get_settings()

engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    future=True,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    """Create tables if they don't exist."""
    import logging

    logger = logging.getLogger(__name__)
    settings.ensure_data_dir()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info(f"Database ready at {settings.database_path}")


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
