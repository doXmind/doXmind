"""
Migration script to add 'contexts' column to messages table.

Run this script once to add the new column:
    python server/migrations/add_contexts_column.py

This is needed because SQLAlchemy's create_all() doesn't add new columns
to existing tables.
"""

import asyncio
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from db.database import engine


async def migrate():
    """Add contexts column to messages table if it doesn't exist."""
    async with engine.begin() as conn:
        # Check if column already exists (SQLite specific)
        result = await conn.execute(text("PRAGMA table_info(messages)"))
        columns = [row[1] for row in result.fetchall()]

        if "contexts" in columns:
            print("Column 'contexts' already exists in messages table.")
            return

        # Add the column
        print("Adding 'contexts' column to messages table...")
        await conn.execute(
            text("ALTER TABLE messages ADD COLUMN contexts JSON")
        )
        print("Migration completed successfully!")


if __name__ == "__main__":
    asyncio.run(migrate())
