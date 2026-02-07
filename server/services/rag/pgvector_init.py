"""PostgreSQL pgvector initialization.

Creates the pgvector extension, vectors table, indexes,
and full-text search support on application startup.
"""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from services.rag.html_utils import EMBEDDING_DIMENSION

logger = logging.getLogger(__name__)


async def init_pgvector(db: AsyncSession):
    """Initialize pgvector extension and create vector table.

    Should be called once at application startup.
    """
    settings = get_settings()

    if not settings.pgvector_enabled:
        logger.info("pgvector is disabled via PGVECTOR_ENABLED=false")
        return

    try:
        # Create pgvector extension
        await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

        # Check if vectors table exists with wrong column type (e.g., TEXT instead of VECTOR)
        # This can happen if tests created the table with a mock schema
        result = await db.execute(
            text("""
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'vectors' AND column_name = 'embedding'
        """)
        )
        row = result.fetchone()

        if row and row[0] == "text":
            # Table exists with wrong type, drop and recreate
            logger.warning("Vectors table has TEXT embedding column, recreating with VECTOR type")
            await db.execute(text("DROP TABLE IF EXISTS vectors CASCADE"))

        # Create vectors table for storing all embeddings
        await db.execute(
            text(f"""
            CREATE TABLE IF NOT EXISTS vectors (
                id VARCHAR(255) PRIMARY KEY,
                content TEXT NOT NULL,
                embedding VECTOR({EMBEDDING_DIMENSION}),
                chunk_type VARCHAR(50) NOT NULL,
                file_id VARCHAR(36),
                conversation_id VARCHAR(36),
                attachment_id VARCHAR(36),
                filename VARCHAR(255),
                chunk_index INTEGER,
                total_chunks INTEGER,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        )

        # Create indexes for efficient querying
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_vectors_file_id ON vectors(file_id)"))
        await db.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_vectors_conversation_id ON vectors(conversation_id)"
            )
        )
        await db.execute(
            text("CREATE INDEX IF NOT EXISTS idx_vectors_chunk_type ON vectors(chunk_type)")
        )
        await db.execute(
            text("CREATE INDEX IF NOT EXISTS idx_vectors_attachment_id ON vectors(attachment_id)")
        )

        # Create HNSW index for vector similarity search (cosine distance)
        await db.execute(
            text("""
            CREATE INDEX IF NOT EXISTS idx_vectors_embedding
            ON vectors USING hnsw (embedding vector_cosine_ops)
        """)
        )

        # =====================================================================
        # Full-Text Search Setup (for Hybrid Search)
        # =====================================================================

        # Add tsvector column for keyword search (if not exists)
        await db.execute(
            text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'vectors' AND column_name = 'search_vector'
                ) THEN
                    ALTER TABLE vectors ADD COLUMN search_vector tsvector;
                END IF;
            END $$;
        """)
        )

        # Create GIN index for fast full-text search
        await db.execute(
            text("""
            CREATE INDEX IF NOT EXISTS idx_vectors_search_vector
            ON vectors USING GIN (search_vector)
        """)
        )

        # Create trigger function to auto-update tsvector on content changes
        await db.execute(
            text("""
            CREATE OR REPLACE FUNCTION vectors_search_vector_update() RETURNS trigger AS $$
            BEGIN
                NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """)
        )

        # Create trigger (drop first to avoid duplicate)
        await db.execute(
            text("""
            DROP TRIGGER IF EXISTS vectors_search_vector_trigger ON vectors;
        """)
        )
        await db.execute(
            text("""
            CREATE TRIGGER vectors_search_vector_trigger
            BEFORE INSERT OR UPDATE ON vectors
            FOR EACH ROW EXECUTE FUNCTION vectors_search_vector_update();
        """)
        )

        # Populate search_vector for existing rows that don't have it
        await db.execute(
            text("""
            UPDATE vectors
            SET search_vector = to_tsvector('english', COALESCE(content, ''))
            WHERE search_vector IS NULL
        """)
        )

        await db.commit()
        logger.info("pgvector initialized successfully with full-text search support")

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to initialize pgvector: {e}")
        raise
