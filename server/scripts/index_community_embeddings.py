"""
Backfill community share embeddings for the recommendation system.

Indexes title + description + tags of all published shares into the vectors
table with chunk_type='community', enabling semantic similarity recommendations.

Usage:
    cd server
    python scripts/index_community_embeddings.py --dry-run
    python scripts/index_community_embeddings.py
    python scripts/index_community_embeddings.py --database-url "..."

Options:
    --dry-run       Preview without creating embeddings
    --database-url  Override database URL (for production use)
    --batch-size    Number of shares to process per batch (default: 20)
"""

import argparse
import asyncio
import json
import os
import sys

# Add server directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from config import get_settings


async def get_session(database_url: str | None = None):
    """Create a database session, optionally with custom URL."""
    if database_url:
        engine = create_async_engine(database_url, echo=False)
        async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        return async_session()
    else:
        from db.database import async_session

        return async_session()


async def index_community_embeddings(
    database_url: str | None = None, dry_run: bool = False, batch_size: int = 20
):
    """Index all published shares for recommendation similarity search."""
    from services.rag.embedding import get_embeddings_batch

    db = await get_session(database_url)

    try:
        # Count published shares
        total_result = await db.execute(
            text("""
                SELECT COUNT(*) FROM document_shares
                WHERE is_published = true AND is_active = true AND visibility = 'public'
            """)
        )
        total = total_result.scalar() or 0

        # Count already indexed
        indexed_result = await db.execute(
            text("SELECT COUNT(*) FROM vectors WHERE chunk_type = 'community'")
        )
        indexed = indexed_result.scalar() or 0

        print("=" * 60)
        print("Community Embedding Indexing")
        print("=" * 60)
        print(f"Total published shares:  {total}")
        print(f"Already indexed:         {indexed}")
        print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")
        print("=" * 60)

        if total == 0:
            print("\nNo published shares to index.")
            return

        # Fetch all published shares
        result = await db.execute(
            text("""
                SELECT id, file_id, user_id, title, description, tags
                FROM document_shares
                WHERE is_published = true AND is_active = true AND visibility = 'public'
                ORDER BY published_at DESC
            """)
        )
        rows = result.fetchall()

        # Process in batches
        created = 0
        skipped = 0

        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            texts_to_embed = []
            batch_meta = []

            for row in batch:
                share_id, file_id, user_id, title, description, tags = row

                text_parts = []
                if title:
                    text_parts.append(title)
                if description:
                    text_parts.append(description)
                if tags and isinstance(tags, list):
                    text_parts.append(" ".join(tags))

                combined = " ".join(text_parts)
                if len(combined) < 5:
                    skipped += 1
                    continue

                texts_to_embed.append(combined)
                batch_meta.append(
                    {
                        "share_id": share_id,
                        "file_id": file_id,
                        "user_id": user_id,
                        "combined_text": combined,
                    }
                )

            if not texts_to_embed:
                continue

            if dry_run:
                for meta in batch_meta:
                    preview = meta["combined_text"][:80]
                    try:
                        print(f"  Would index: {meta['share_id'][:8]}... | {preview}")
                    except UnicodeEncodeError:
                        print(f"  Would index: {meta['share_id'][:8]}... | [unicode content]")
                created += len(texts_to_embed)
                continue

            # Generate embeddings
            print(f"\nBatch {i // batch_size + 1}: embedding {len(texts_to_embed)} shares...")
            embeddings = await get_embeddings_batch(texts_to_embed)

            # Insert into vectors table
            for embedding, meta in zip(embeddings, batch_meta, strict=False):
                vector_id = f"community_{meta['share_id']}"
                await db.execute(
                    text("""
                        INSERT INTO vectors (id, content, embedding, chunk_type, file_id, metadata)
                        VALUES (:id, :content, :embedding, 'community', :file_id,
                                CAST(:meta AS jsonb))
                        ON CONFLICT (id) DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata
                    """),
                    {
                        "id": vector_id,
                        "content": meta["combined_text"],
                        "embedding": str(embedding),
                        "file_id": meta["file_id"],
                        "meta": json.dumps(
                            {
                                "share_id": meta["share_id"],
                                "user_id": meta["user_id"],
                            }
                        ),
                    },
                )

            await db.commit()
            created += len(texts_to_embed)
            print(f"  Committed {len(texts_to_embed)} embeddings")

        print("\n" + "=" * 60)
        print("Summary")
        print("=" * 60)
        print(f"Indexed: {created}")
        print(f"Skipped (too short): {skipped}")
        if dry_run:
            print("\nThis was a DRY RUN. No changes were made.")

    finally:
        await db.close()


def main():
    parser = argparse.ArgumentParser(description="Index community share embeddings")
    parser.add_argument("--dry-run", action="store_true", help="Preview without indexing")
    parser.add_argument("--database-url", type=str, help="Database URL (overrides config)")
    parser.add_argument("--batch-size", type=int, default=20, help="Batch size (default: 20)")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.pgvector_enabled:
        print("pgvector is disabled. Enable it in settings to use this script.")
        return

    asyncio.run(
        index_community_embeddings(
            database_url=args.database_url, dry_run=args.dry_run, batch_size=args.batch_size
        )
    )

    print("\nDone!")


if __name__ == "__main__":
    main()
