"""
Backfill missing token counts for existing messages.

This script estimates token counts using a simple heuristic (chars / 4)
for messages that don't have input_tokens or output_tokens set.

Usage:
    cd server
    python scripts/backfill_tokens.py --dry-run                    # Preview with local DB
    python scripts/backfill_tokens.py --database-url "..." --dry-run  # Preview with custom DB
    python scripts/backfill_tokens.py --database-url "..."            # Execute on custom DB

Options:
    --dry-run       Preview changes without updating the database
    --database-url  Override database URL (for production use)
    --batch-size    Number of messages to process per batch (default: 50)
"""

import argparse
import asyncio
import os
import sys

# Add server directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker


def count_tokens_for_text(content: str) -> int:
    """Estimate token count for a given text using chars/4 heuristic."""
    if not content or not content.strip():
        return 0
    return max(1, len(content) // 4)


async def get_session(database_url: str | None = None):
    """Create a database session, optionally with custom URL."""
    if database_url:
        engine = create_async_engine(database_url, echo=False)
        async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        return async_session()
    else:
        from db.database import async_session_factory

        return async_session_factory()


async def count_missing_tokens(db: AsyncSession) -> dict:
    """Count messages with missing token data using raw SQL."""
    # Total messages
    total_result = await db.execute(text("SELECT COUNT(*) FROM messages"))
    total = total_result.scalar()

    # Messages with missing output_tokens
    missing_output_result = await db.execute(
        text("SELECT COUNT(*) FROM messages WHERE output_tokens IS NULL")
    )
    missing_output = missing_output_result.scalar()

    # Messages with missing input_tokens
    missing_input_result = await db.execute(
        text("SELECT COUNT(*) FROM messages WHERE input_tokens IS NULL")
    )
    missing_input = missing_input_result.scalar()

    # By role
    user_missing_result = await db.execute(
        text("""SELECT COUNT(*) FROM messages
                WHERE role = 'user'
                AND (output_tokens IS NULL OR input_tokens IS NULL)""")
    )
    user_missing = user_missing_result.scalar()

    assistant_missing_result = await db.execute(
        text("""SELECT COUNT(*) FROM messages
                WHERE role = 'assistant'
                AND (output_tokens IS NULL OR input_tokens IS NULL)""")
    )
    assistant_missing = assistant_missing_result.scalar()

    return {
        "total": total,
        "missing_output": missing_output,
        "missing_input": missing_input,
        "user_missing": user_missing,
        "assistant_missing": assistant_missing,
    }


async def backfill_tokens(
    database_url: str | None = None, dry_run: bool = False, batch_size: int = 50
):
    """Backfill token counts for messages with missing data."""
    db = await get_session(database_url)

    try:
        # First, show statistics
        stats = await count_missing_tokens(db)
        print("=" * 60)
        print("Database Statistics")
        print("=" * 60)
        print(f"Total messages:              {stats['total']}")
        print(f"Missing output_tokens:       {stats['missing_output']}")
        print(f"Missing input_tokens:        {stats['missing_input']}")
        print(f"User messages to update:     {stats['user_missing']}")
        print(f"Assistant messages to update:{stats['assistant_missing']}")
        print("=" * 60)
        print(f"Mode: {'DRY RUN (no changes)' if dry_run else 'LIVE UPDATE'}")
        print("=" * 60)

        if stats["missing_output"] == 0 and stats["missing_input"] == 0:
            print("\nNo messages need updating. All done!")
            return

        if not dry_run:
            confirm = input("\nProceed with update? [y/N]: ")
            if confirm.lower() != "y":
                print("Aborted.")
                return

        # Process in batches using raw SQL
        # Query only records that we can actually update:
        # - user messages: missing output_tokens OR missing input_tokens
        # - assistant messages: missing output_tokens only (we skip input_tokens)
        offset = 0
        total_updated = 0
        total_skipped = 0

        while True:
            # Fetch a batch of messages with missing tokens using raw SQL
            result = await db.execute(
                text("""SELECT id, role, content, thinking, input_tokens, output_tokens
                        FROM messages
                        WHERE (role = 'user' AND (output_tokens IS NULL OR input_tokens IS NULL))
                           OR (role = 'assistant' AND output_tokens IS NULL)
                        ORDER BY created_at
                        LIMIT :limit OFFSET :offset"""),
                {"limit": batch_size, "offset": offset if dry_run else 0},
            )
            rows = result.fetchall()

            if not rows:
                break

            print(f"\nProcessing batch: {len(rows)} messages...")

            batch_updated = 0
            batch_skipped = 0

            for row in rows:
                msg_id, role, content, thinking, input_tokens, output_tokens = row
                updates = []
                update_values = {}

                # Calculate output tokens
                if role == "assistant" and output_tokens is None:
                    output_text = content or ""
                    if thinking:
                        output_text = f"{thinking}\n\n{output_text}"
                    calculated_output = count_tokens_for_text(output_text)
                    updates.append(f"output_tokens={calculated_output}")
                    update_values["output_tokens"] = calculated_output
                    batch_updated += 1

                elif role == "user" and output_tokens is None:
                    updates.append("output_tokens=0")
                    update_values["output_tokens"] = 0
                    batch_updated += 1

                # Calculate input tokens for user messages
                if role == "user" and input_tokens is None:
                    input_text = content or ""
                    calculated_input = count_tokens_for_text(input_text)
                    updates.append(f"input_tokens={calculated_input}")
                    update_values["input_tokens"] = calculated_input
                    batch_updated += 1

                elif role == "assistant" and input_tokens is None:
                    batch_skipped += 1

                if updates:
                    content_preview = (content or "")[:50].replace("\n", " ")
                    # Handle encoding issues for Windows console
                    try:
                        print(
                            f"  {msg_id[:8]}... [{role}] {', '.join(updates)} | {content_preview}..."
                        )
                    except UnicodeEncodeError:
                        print(
                            f"  {msg_id[:8]}... [{role}] {', '.join(updates)} | [content contains special chars]"
                        )

                    # Execute update if not dry run
                    if not dry_run and update_values:
                        set_clause = ", ".join([f"{k} = :{k}" for k in update_values])
                        update_values["msg_id"] = msg_id
                        await db.execute(
                            text(f"UPDATE messages SET {set_clause} WHERE id = :msg_id"),
                            update_values,
                        )

            # Commit batch
            if not dry_run and batch_updated > 0:
                await db.commit()
                print(f"  Committed batch: {batch_updated} updates")

            total_updated += batch_updated
            total_skipped += batch_skipped

            if dry_run:
                offset += batch_size

        print("\n" + "=" * 60)
        print("Summary")
        print("=" * 60)
        print(f"Total fields updated: {total_updated}")
        print(f"Total fields skipped: {total_skipped} (assistant input_tokens)")
        if dry_run:
            print("\nThis was a DRY RUN. No changes were made.")
        else:
            print("\nChanges committed to database.")

    finally:
        await db.close()


def main():
    parser = argparse.ArgumentParser(description="Backfill missing token counts")
    parser.add_argument("--dry-run", action="store_true", help="Preview without updating")
    parser.add_argument("--database-url", type=str, help="Database URL (overrides config)")
    parser.add_argument("--batch-size", type=int, default=50, help="Batch size (default: 50)")
    args = parser.parse_args()

    print("=" * 60)
    print("Token Backfill Script")
    print("=" * 60)

    if args.database_url:
        # Mask password in output
        masked_url = args.database_url
        if "@" in masked_url:
            parts = masked_url.split("@")
            masked_url = parts[0][:20] + "...@" + parts[1]
        print(f"Using database: {masked_url}")
    else:
        print("Using database from config")

    asyncio.run(
        backfill_tokens(
            database_url=args.database_url, dry_run=args.dry_run, batch_size=args.batch_size
        )
    )

    print("\nDone!")


if __name__ == "__main__":
    main()
