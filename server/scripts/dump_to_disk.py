"""Dump all documents in ~/.doxmind/doxmind.db to a disk markdown tree.

This is the safety-net / migration-seed script. It reads the SQLite DB and
writes each non-folder File row as a .md file with YAML frontmatter, mirroring
the parent_id hierarchy as real directories. Images referenced in the content
are copied into a sibling assets/ folder and URLs are rewritten to relative
paths.

Usage:
    python server/scripts/dump_to_disk.py [--out PATH] [--db PATH] [--force]

Defaults:
    --db   ~/.doxmind/doxmind.db
    --out  ~/Documents/doxmind-export

Properties:
- Read-only against the source DB.
- Refuses to write into a non-empty --out unless --force is passed.
- Preserves File.id in the frontmatter so page-link references can be
  rebuilt on a future re-import.
- Prefers File.content_markdown; falls back to converting File.content via
  the same html_to_markdown() the API uses on save.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Make `from utils...` importable when running as `python server/scripts/...`
_SERVER_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVER_ROOT))

from utils.markdown_converter import html_to_markdown  # noqa: E402


_INVALID_FS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_IMAGE_URL_RE = re.compile(
    r'/api/images/(?P<user>[^/"\'\s)]+)/(?P<file>[^"\'\s)]+)'
)


def _sanitize(name: str, *, is_folder: bool) -> str:
    cleaned = _INVALID_FS_CHARS.sub("_", name).strip().rstrip(".")
    if not is_folder and cleaned.lower().endswith(".md"):
        cleaned = cleaned[:-3].rstrip()
    return cleaned or "untitled"


def _iso(dt: str | None) -> str | None:
    if not dt:
        return None
    try:
        return datetime.fromisoformat(dt).isoformat()
    except ValueError:
        return dt


def _yaml_escape(value: str) -> str:
    if any(ch in value for ch in ":#\"\n") or value.strip() != value:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return value


def _frontmatter(row: sqlite3.Row) -> str:
    fields: list[tuple[str, str]] = [("id", row["id"])]
    if row["name"]:
        fields.append(("title", row["name"]))
    if row["icon"]:
        fields.append(("icon", row["icon"]))
    if row["is_favorite"]:
        fields.append(("favorite", "true"))
    if row["cover_image_url"]:
        fields.append(("cover", row["cover_image_url"]))
    created = _iso(row["created_at"])
    updated = _iso(row["updated_at"])
    if created:
        fields.append(("created", created))
    if updated:
        fields.append(("updated", updated))
    body = "\n".join(f"{k}: {_yaml_escape(v)}" for k, v in fields)
    return f"---\n{body}\n---\n\n"


def _build_tree(rows: list[sqlite3.Row]) -> dict[str | None, list[sqlite3.Row]]:
    children: dict[str | None, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        children[row["parent_id"]].append(row)
    for siblings in children.values():
        siblings.sort(
            key=lambda r: (
                not r["is_folder"],
                r["position"] if r["position"] is not None else 0,
                r["name"] or "",
            )
        )
    return children


def _unique_path(parent: Path, base: str, ext: str) -> Path:
    candidate = parent / f"{base}{ext}"
    n = 2
    while candidate.exists():
        candidate = parent / f"{base} ({n}){ext}"
        n += 1
    return candidate


def _rewrite_images(
    markdown: str,
    images_root: Path,
    assets_dir: Path,
    seen: set[Path],
) -> tuple[str, int, list[str]]:
    """Rewrite /api/images/... URLs to relative ./assets/<file> and copy assets.

    Returns (new_markdown, copied_count, missing_sources).
    """
    copied = 0
    missing: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        nonlocal copied
        user = match.group("user")
        filename = match.group("file")
        src = images_root / user / filename
        if not src.exists():
            missing.append(str(src))
            return match.group(0)
        dest = assets_dir / filename
        if dest not in seen:
            assets_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            seen.add(dest)
            copied += 1
        return f"./assets/{filename}"

    return _IMAGE_URL_RE.sub(_replace, markdown), copied, missing


def dump(db_path: Path, out_dir: Path, force: bool) -> None:
    if not db_path.exists():
        raise SystemExit(f"db not found: {db_path}")

    if out_dir.exists() and any(out_dir.iterdir()) and not force:
        raise SystemExit(
            f"refusing to write into non-empty {out_dir} (pass --force to override)"
        )
    out_dir.mkdir(parents=True, exist_ok=True)

    images_root = db_path.parent / "storage" / "images"

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, content, content_markdown, is_folder, is_favorite, "
        "icon, cover_image_url, parent_id, position, created_at, updated_at "
        "FROM files WHERE deleted_at IS NULL"
    ).fetchall()
    conn.close()

    tree = _build_tree(rows)

    stats = {
        "folders": 0,
        "docs": 0,
        "empty": 0,
        "images_copied": 0,
        "images_missing": 0,
        "fallback_html": 0,
    }
    seen_assets: set[Path] = set()
    missing_images: list[str] = []

    def walk(parent_id: str | None, parent_path: Path) -> None:
        for row in tree.get(parent_id, []):
            base = _sanitize(row["name"] or "untitled", is_folder=bool(row["is_folder"]))
            if row["is_folder"]:
                folder_path = _unique_path(parent_path, base, "")
                folder_path.mkdir(parents=True, exist_ok=True)
                stats["folders"] += 1
                walk(row["id"], folder_path)
                continue

            md = row["content_markdown"]
            if not md:
                if row["content"]:
                    md = html_to_markdown(row["content"])
                    stats["fallback_html"] += 1
                else:
                    md = ""
                    stats["empty"] += 1

            assets_dir = parent_path / "assets"
            md, copied, missing = _rewrite_images(
                md, images_root, assets_dir, seen_assets
            )
            stats["images_copied"] += copied
            stats["images_missing"] += len(missing)
            missing_images.extend(missing)

            file_path = _unique_path(parent_path, base, ".md")
            file_path.write_text(_frontmatter(row) + md, encoding="utf-8")
            stats["docs"] += 1

    walk(None, out_dir)

    print(f"dump complete -> {out_dir}")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    if missing_images:
        print("missing image sources (first 10):")
        for path in missing_images[:10]:
            print(f"  {path}")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--db",
        type=Path,
        default=Path.home() / ".doxmind" / "doxmind.db",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path.home() / "Documents" / "doxmind-export",
    )
    p.add_argument("--force", action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    dump(args.db, args.out, args.force)
