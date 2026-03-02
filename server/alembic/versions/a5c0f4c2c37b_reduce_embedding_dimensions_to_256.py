"""reduce_embedding_dimensions_to_256

Revision ID: a5c0f4c2c37b
Revises: 0b0afee66952
Create Date: 2026-02-24 20:59:50.682344

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a5c0f4c2c37b"
down_revision: str | Sequence[str] | None = "0b0afee66952"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Reduce embedding dimensions from 1536 to 256.

    WARNING: This will drop and recreate the embedding column,
    resulting in loss of all existing vector embeddings.
    You will need to re-index all documents after this migration.
    """
    # Skip if vectors table doesn't exist (fresh database)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vectors') THEN
                DROP INDEX IF EXISTS idx_vectors_embedding;
                ALTER TABLE vectors DROP COLUMN IF EXISTS embedding;
                ALTER TABLE vectors ADD COLUMN embedding VECTOR(256);
                CREATE INDEX idx_vectors_embedding ON vectors USING hnsw (embedding vector_cosine_ops);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    """Restore embedding dimensions from 256 to 1536.

    WARNING: This will drop and recreate the embedding column,
    resulting in loss of all existing vector embeddings.
    """
    # Skip if vectors table doesn't exist (fresh database)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vectors') THEN
                DROP INDEX IF EXISTS idx_vectors_embedding;
                ALTER TABLE vectors DROP COLUMN IF EXISTS embedding;
                ALTER TABLE vectors ADD COLUMN embedding VECTOR(1536);
                CREATE INDEX idx_vectors_embedding ON vectors USING hnsw (embedding vector_cosine_ops);
            END IF;
        END $$;
    """)
