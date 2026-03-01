"""drop vectors table and pgvector extension

Revision ID: 0013_drop_vectors
Revises: b4946964f9c0
Create Date: 2026-02-27

Removes the vectors table and pgvector extension as RAG/embedding
search has been replaced with agentic text search.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013_drop_vectors"
down_revision: str | Sequence[str] | None = "b4946964f9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vectors CASCADE")
    # Drop Heroku-managed extension trigger if it exists (references rds_superuser
    # role that doesn't exist on EC2, causing DROP EXTENSION to fail)
    op.execute("""
        DO $$
        BEGIN
            DROP FUNCTION IF EXISTS _heroku.extension_before_drop() CASCADE;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END $$;
    """)
    op.execute("DROP EXTENSION IF EXISTS vector CASCADE")


def downgrade() -> None:
    # Re-create pgvector extension and vectors table if needed
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        CREATE TABLE IF NOT EXISTS vectors (
            id VARCHAR PRIMARY KEY,
            content TEXT,
            embedding vector(256),
            chunk_type VARCHAR(50) DEFAULT 'document',
            chunk_index INTEGER DEFAULT 0,
            file_id VARCHAR,
            metadata JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_vectors_file_id ON vectors (file_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_vectors_chunk_type ON vectors (chunk_type)
    """)
