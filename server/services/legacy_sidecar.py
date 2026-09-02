"""Read-only helpers for locating and recognizing historical sidecars."""

from __future__ import annotations

import hashlib
from pathlib import Path

SIDECAR_VERSION = 2


def sidecar_path_for(document_path: Path) -> Path:
    name = document_path.name
    lower = name.lower()
    if lower.endswith(".markdown"):
        stem = name[: -len(".markdown")]
    elif lower.endswith(".md"):
        stem = name[: -len(".md")]
    else:
        stem = name
    return document_path.parent / f".{stem}.doxmind"


def hash_markdown(content: str) -> str:
    """Hash a legacy sidecar's historical Markdown freshness value."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()
