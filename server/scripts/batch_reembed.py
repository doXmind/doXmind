"""Batch re-embedding script for all files after dimension change.

This script re-generates embeddings for all files in the database after
changing the embedding dimensions (e.g., from 1536 to 256).

Usage:
    python scripts/batch_reembed.py [--limit N] [--skip N] [--dry-run]

Options:
    --limit N    Only process N files (for testing)
    --skip N     Skip first N files
    --dry-run    Show what would be done without doing it
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File, async_session
from services.rag.search import RAGService
from services.rag.chunking import DEFAULT_STRATEGY_FACTORY

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def get_all_files(
    session: AsyncSession, limit: int | None = None, skip: int = 0
) -> list[File]:
    """Get all files from database."""
    query = select(File).order_by(File.created_at)

    if skip > 0:
        query = query.offset(skip)

    if limit:
        query = query.limit(limit)

    result = await session.execute(query)
    return list(result.scalars().all())


async def reembed_file(
    session: AsyncSession, file: File, dry_run: bool = False
) -> bool:
    """Re-embed a single file using RAGService.

    Args:
        session: Database session
        file: File object to re-embed
        dry_run: If True, don't actually store embeddings

    Returns:
        True if successful, False otherwise
    """
    try:
        if not file.content or not file.content.strip():
            logger.warning(f"File {file.id} ({file.name}) has no content, skipping")
            return False

        # Skip files that are too large (> 500KB to avoid stack overflow)
        if len(file.content) > 500000:
            logger.warning(
                f"File {file.id} ({file.name}) is too large ({len(file.content)} chars), skipping"
            )
            return False

        logger.info(
            f"Re-embedding file {file.id}: {file.name} ({len(file.content)} chars)"
        )

        if dry_run:
            logger.info(f"  [DRY RUN] Would re-embed file {file.id}")
            return True

        # Create RAGService instance
        rag = RAGService(session)

        # Auto-select chunking strategy based on document type
        strategy = DEFAULT_STRATEGY_FACTORY.get_strategy(file.content, file.name)
        logger.info(f"  Using chunking strategy: {strategy.__class__.__name__}")

        # Index the file (this will delete old vectors and create new ones)
        await rag.index_file(
            file_id=file.id,
            content=file.content,
            metadata={"name": file.name, "user_id": file.user_id},
            strategy=strategy,
        )

        # Also index sentences for in-document search
        await rag.index_file_sentences(
            file_id=file.id,
            content=file.content,
            metadata={"name": file.name, "user_id": file.user_id},
        )

        # Commit the transaction
        await session.commit()

        logger.info(f"  ✅ Successfully re-embedded file {file.id}")
        return True

    except Exception as e:
        logger.error(f"  ❌ Failed to re-embed file {file.id}: {e}", exc_info=True)
        await session.rollback()
        return False


async def main(
    limit: int | None = None, skip: int = 0, dry_run: bool = False
) -> None:
    """Main batch re-embedding function."""
    logger.info("=" * 80)
    logger.info("BATCH RE-EMBEDDING SCRIPT")
    logger.info("=" * 80)

    if dry_run:
        logger.info("DRY RUN MODE - No changes will be made")

    async with async_session() as session:
        # Get all files
        logger.info(f"Fetching files (skip={skip}, limit={limit or 'all'})...")
        files = await get_all_files(session, limit=limit, skip=skip)
        logger.info(f"Found {len(files)} files to process")

        if not files:
            logger.warning("No files found to process")
            return

        # Process files
        success_count = 0
        skip_count = 0
        fail_count = 0

        for i, file in enumerate(files, 1):
            logger.info(f"\n[{i}/{len(files)}] Processing file {file.id}...")

            result = await reembed_file(session, file, dry_run=dry_run)

            if result:
                success_count += 1
            else:
                fail_count += 1

            # Small delay to avoid rate limiting
            if not dry_run and i < len(files):
                await asyncio.sleep(0.5)

        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)
        logger.info(f"Total files:    {len(files)}")
        logger.info(f"✅ Successful:  {success_count}")
        logger.info(f"❌ Failed:      {fail_count}")
        logger.info("=" * 80)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Batch re-embed all files after dimension change"
    )
    parser.add_argument(
        "--limit", type=int, help="Only process N files (for testing)", default=None
    )
    parser.add_argument("--skip", type=int, help="Skip first N files", default=0)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without doing it",
    )

    args = parser.parse_args()

    try:
        asyncio.run(main(limit=args.limit, skip=args.skip, dry_run=args.dry_run))
    except KeyboardInterrupt:
        logger.info("\n\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
