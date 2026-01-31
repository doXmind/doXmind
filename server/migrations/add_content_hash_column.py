"""
Migration script to add 'content_hash' column to files table.

Run this script once to add the new column:
    python server/migrations/add_content_hash_column.py

This is needed because SQLAlchemy's create_all() doesn't add new columns
to existing tables.
"""

import asyncio
import hashlib
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from config import get_settings
from db.database import engine


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hash of content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


async def migrate():
    """Add content_hash column to files table if it doesn't exist."""
    settings = get_settings()
    database_url = settings.async_database_url
    is_sqlite = database_url.startswith("sqlite")

    async with engine.begin() as conn:
        # Check if column already exists
        if is_sqlite:
            result = await conn.execute(text("PRAGMA table_info(files)"))
            columns = [row[1] for row in result.fetchall()]
        else:
            # PostgreSQL
            result = await conn.execute(
                text("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'files' AND column_name = 'content_hash'
                """)
            )
            columns = [row[0] for row in result.fetchall()]

        if "content_hash" in columns:
            print("Column 'content_hash' already exists in files table.")
            return

        # Add the column
        print("Adding 'content_hash' column to files table...")
        await conn.execute(text("ALTER TABLE files ADD COLUMN content_hash VARCHAR(64)"))

        # Backfill existing rows with computed hash
        print("Backfilling content_hash for existing files...")
        result = await conn.execute(text("SELECT id, content FROM files"))
        rows = result.fetchall()

        for file_id, content in rows:
            if content:
                content_hash = compute_content_hash(content)
                await conn.execute(
                    text("UPDATE files SET content_hash = :hash WHERE id = :id"),
                    {"hash": content_hash, "id": file_id},
                )

        print(f"Migration completed successfully! Updated {len(rows)} files.")


if __name__ == "__main__":
    asyncio.run(migrate())
