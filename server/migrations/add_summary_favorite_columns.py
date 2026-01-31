"""
Migration script to add 'summary' and 'is_favorite' columns to files table.

Run this script once to add the new columns:
    python server/migrations/add_summary_favorite_columns.py

This is needed because SQLAlchemy's create_all() doesn't add new columns
to existing tables.
"""

import asyncio
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from config import get_settings
from db.database import engine


async def migrate():
    """Add summary and is_favorite columns to files table if they don't exist."""
    settings = get_settings()
    database_url = settings.async_database_url
    is_sqlite = database_url.startswith("sqlite")

    async with engine.begin() as conn:
        # Check existing columns
        if is_sqlite:
            result = await conn.execute(text("PRAGMA table_info(files)"))
            columns = [row[1] for row in result.fetchall()]
        else:
            # PostgreSQL
            result = await conn.execute(
                text("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'files'
                """)
            )
            columns = [row[0] for row in result.fetchall()]

        # Add summary column if it doesn't exist
        if "summary" not in columns:
            print("Adding 'summary' column to files table...")
            await conn.execute(text("ALTER TABLE files ADD COLUMN summary TEXT"))
            print("Added 'summary' column.")
        else:
            print("Column 'summary' already exists in files table.")

        # Add is_favorite column if it doesn't exist
        if "is_favorite" not in columns:
            print("Adding 'is_favorite' column to files table...")
            if is_sqlite:
                await conn.execute(
                    text("ALTER TABLE files ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE")
                )
            else:
                # PostgreSQL
                await conn.execute(
                    text("ALTER TABLE files ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE")
                )
            print("Added 'is_favorite' column.")
        else:
            print("Column 'is_favorite' already exists in files table.")

        print("Migration completed successfully!")


if __name__ == "__main__":
    asyncio.run(migrate())
