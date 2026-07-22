"""Read-only helpers for locating and recognizing historical sidecars."""

from __future__ import annotations

import hashlib
import re
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


def placeholder_re_for(block_types: tuple[str, ...]) -> re.Pattern[str]:
    if not block_types:
        return re.compile(r"a\Ab")
    alternatives = "|".join(re.escape(block_type) for block_type in block_types)
    return re.compile(
        rf"<!--\s*(?P<block_type>{alternatives})\s+"
        r'id="(?P<id>[^"]+)"\s+'
        r'src="(?P<src>[^"]+)"(?P<attrs>.*?)\s*-->'
    )


def hash_markdown(content: str) -> str:
    """Hash a legacy sidecar's historical Markdown freshness value."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()
