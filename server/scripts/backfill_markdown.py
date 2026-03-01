"""One-off script to backfill content_markdown for all existing files.

Usage (inside backend container):
    python scripts/backfill_markdown.py

Converts HTML content → markdown using the same html_to_markdown() function
that the API uses on save. Skips folders and files with empty content.

Uses per-file fetching and thread-based timeout to handle hung conversions.
"""

import contextlib
import threading
import time

from sqlalchemy import create_engine, text

from config import get_settings
from utils.markdown_converter import html_to_markdown

settings = get_settings()

# Build sync database URL (strip asyncpg driver)
db_url = settings.database_url
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
if "+asyncpg" in db_url:
    db_url = db_url.replace("+asyncpg", "")

engine = create_engine(db_url)

TIMEOUT_SECONDS = 30  # max time per file conversion


def convert_with_timeout(content, timeout=TIMEOUT_SECONDS):
    """Run html_to_markdown in a thread with timeout. Returns (result, error)."""
    result = [None]
    error = [None]

    def worker():
        try:
            result[0] = html_to_markdown(content)
        except Exception as e:
            error[0] = e

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout=timeout)

    if t.is_alive():
        # Thread is still running - timed out
        return None, TimeoutError(f"Conversion timed out after {timeout}s")

    if error[0]:
        return None, error[0]

    return result[0], None


def backfill():
    start = time.time()

    with engine.connect() as conn:
        # Count files needing backfill
        result = conn.execute(
            text("""
                SELECT COUNT(*) FROM files
                WHERE is_folder = false
                  AND content IS NOT NULL
                  AND content != ''
                  AND content_markdown IS NULL
            """)
        )
        total = result.scalar()
        print(f"Found {total} files needing markdown backfill", flush=True)

        if total == 0:
            print("Nothing to do!")
            return

        # Fetch ONLY ids and metadata (no content) to keep memory low
        ids_rows = conn.execute(
            text("""
                SELECT id, name, length(content) as len FROM files
                WHERE is_folder = false
                  AND content IS NOT NULL
                  AND content != ''
                  AND content_markdown IS NULL
                ORDER BY length(content) ASC
            """)
        ).fetchall()

        print(f"Fetched {len(ids_rows)} file IDs, processing one by one...", flush=True)

        success = 0
        errors = 0
        timeouts = 0

        for i, (file_id, name, content_len) in enumerate(ids_rows, 1):
            t0 = time.time()
            try:
                # Fetch content for this single file
                row = conn.execute(
                    text("SELECT content FROM files WHERE id = :id"),
                    {"id": file_id},
                ).fetchone()

                if not row or not row[0]:
                    errors += 1
                    print(f"  SKIP [{i}/{total}] {file_id} ({name}): no content", flush=True)
                    continue

                content = row[0]
                md, err = convert_with_timeout(content)

                if err:
                    if isinstance(err, TimeoutError):
                        timeouts += 1
                        print(f"  TIMEOUT [{i}/{total}] {file_id} ({name}, {content_len}ch)", flush=True)
                    else:
                        errors += 1
                        print(f"  ERROR [{i}/{total}] {file_id} ({name}, {content_len}ch): {str(err)[:100]}", flush=True)
                    continue

                conn.execute(
                    text("UPDATE files SET content_markdown = :md WHERE id = :id"),
                    {"md": md, "id": file_id},
                )
                conn.commit()
                success += 1

                dt = time.time() - t0
                if dt > 2:
                    print(f"  SLOW [{i}/{total}] {file_id} ({name}, {content_len}ch): {dt:.1f}s", flush=True)

            except Exception as e:
                errors += 1
                err_msg = str(e)[:120]
                print(f"  ERROR [{i}/{total}] {file_id} ({name}, {content_len}ch): {err_msg}", flush=True)
                with contextlib.suppress(Exception):
                    conn.rollback()

            if i % 20 == 0:
                elapsed = time.time() - start
                print(f"  [{i}/{total}] {success} ok, {errors} err, {timeouts} timeout ({elapsed:.0f}s)", flush=True)

        # Final status
        elapsed = time.time() - start
        print(f"\nDone in {elapsed:.1f}s: {success} converted, {errors} errors, {timeouts} timeouts out of {total}", flush=True)


if __name__ == "__main__":
    backfill()
