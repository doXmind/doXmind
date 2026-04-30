"""SQLite runtime metadata for the local sidecar edition.

Documents, folders, rich editor HTML, and database-block data are not stored
here. They live in the user's Markdown workspace as `.md` files plus hidden
`.doxmind` sidecars. SQLite is reserved for future app-level local metadata
or disposable caches.
"""

from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, String
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import get_settings


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class AppMetadata(Base):
    """Small key/value table for future non-document app metadata."""

    __tablename__ = "app_metadata"

    key = Column(String(128), primary_key=True)
    value = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


settings = get_settings()

engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    future=True,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    """Create the metadata schema if it does not exist."""
    import logging

    logger = logging.getLogger(__name__)
    settings.ensure_data_dir()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info(f"Metadata database ready at {settings.database_path}")


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
