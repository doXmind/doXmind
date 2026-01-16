"""Database migration script.

Adds user_id columns to existing tables and creates new user-related tables.
Run this script to migrate an existing database to support user authentication.

Usage:
    python migrate_db.py
"""

import sqlite3
from pathlib import Path

# Get the database path
DB_PATH = Path(__file__).parent / "data" / "app.db"


def migrate():
    """Run database migrations."""
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        print("No migration needed - database will be created on first run.")
        return

    print(f"Migrating database: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check existing tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        existing_tables = {row[0] for row in cursor.fetchall()}
        print(f"Existing tables: {existing_tables}")

        # 1. Create users table if not exists
        if "users" not in existing_tables:
            print("Creating 'users' table...")
            cursor.execute("""
                CREATE TABLE users (
                    id VARCHAR(36) PRIMARY KEY,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    username VARCHAR(100),
                    hashed_password VARCHAR(255),
                    oauth_provider VARCHAR(50),
                    oauth_id VARCHAR(255),
                    is_verified BOOLEAN DEFAULT 0,
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX ix_users_email ON users(email)")
            print("  [OK] Created 'users' table")

        # 2. Create email_verifications table if not exists
        if "email_verifications" not in existing_tables:
            print("Creating 'email_verifications' table...")
            cursor.execute("""
                CREATE TABLE email_verifications (
                    id VARCHAR(36) PRIMARY KEY,
                    email VARCHAR(255) NOT NULL,
                    code VARCHAR(6) NOT NULL,
                    pending_username VARCHAR(100),
                    pending_password_hash VARCHAR(255),
                    attempts INTEGER DEFAULT 0,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX ix_email_verifications_email ON email_verifications(email)")
            print("  [OK] Created 'email_verifications' table")

        # 3. Create password_resets table if not exists
        if "password_resets" not in existing_tables:
            print("Creating 'password_resets' table...")
            cursor.execute("""
                CREATE TABLE password_resets (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL,
                    token VARCHAR(255) NOT NULL UNIQUE,
                    expires_at TIMESTAMP NOT NULL,
                    used BOOLEAN DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            cursor.execute("CREATE INDEX ix_password_resets_token ON password_resets(token)")
            print("  [OK] Created 'password_resets' table")

        # 4. Add user_id column to files table if not exists
        if "files" in existing_tables:
            cursor.execute("PRAGMA table_info(files)")
            columns = {row[1] for row in cursor.fetchall()}
            if "user_id" not in columns:
                print("Adding 'user_id' column to 'files' table...")
                cursor.execute("ALTER TABLE files ADD COLUMN user_id VARCHAR(36)")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_files_user_id ON files(user_id)")
                print("  [OK] Added 'user_id' column to 'files' table")
            else:
                print("  - 'files.user_id' column already exists")

        # 5. Add user_id column to conversations table if not exists
        if "conversations" in existing_tables:
            cursor.execute("PRAGMA table_info(conversations)")
            columns = {row[1] for row in cursor.fetchall()}
            if "user_id" not in columns:
                print("Adding 'user_id' column to 'conversations' table...")
                cursor.execute("ALTER TABLE conversations ADD COLUMN user_id VARCHAR(36)")
                cursor.execute("CREATE INDEX IF NOT EXISTS ix_conversations_user_id ON conversations(user_id)")
                print("  [OK] Added 'user_id' column to 'conversations' table")
            else:
                print("  - 'conversations.user_id' column already exists")

        conn.commit()
        print("\n[SUCCESS] Migration completed successfully!")

    except Exception as e:
        conn.rollback()
        print(f"\n[ERROR] Migration failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
