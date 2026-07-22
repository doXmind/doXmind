"""Source and durable-write helpers for Markdown Pages."""

from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any


def parse_yaml_scalar(value: str) -> Any:
    token = _strip_yaml_inline_comment(value).strip()
    if token.lower() == "true":
        return True
    if token.lower() == "false":
        return False
    if token.lower() == "null" or token == "~":
        return None
    try:
        return json.loads(token)
    except json.JSONDecodeError:
        if len(token) >= 2 and token.startswith("'") and token.endswith("'"):
            return token[1:-1].replace("''", "'")
        return token


def portable_page_id_from_token(token: str) -> str | None:
    value = parse_yaml_scalar(token)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if re.fullmatch(r"[A-Za-z0-9._:-]+", value) else None


def _strip_yaml_inline_comment(value: str) -> str:
    quote: str | None = None
    escaped = False
    index = 0
    while index < len(value):
        char = value[index]
        if quote == '"':
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif quote == "'":
            if char == quote and index + 1 < len(value) and value[index + 1] == quote:
                index += 1
            elif char == quote:
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char == "#" and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
        index += 1
    return value


def parse_frontmatter(raw: str) -> tuple[dict[str, Any], str]:
    source = raw.removeprefix("\ufeff")
    if extract_frontmatter_block(raw) is None:
        return {"id": str(uuid.uuid4())}, raw
    lines = source.splitlines()
    if not lines or lines[0] != "---":
        return {"id": str(uuid.uuid4())}, raw

    closing_index = next(
        (index for index, line in enumerate(lines[1:], start=1) if line == "---"),
        None,
    )
    if closing_index is None:
        return {"id": str(uuid.uuid4())}, raw

    meta: dict[str, Any] = {}
    for line in lines[1:closing_index]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key:
            meta[key] = parse_yaml_scalar(value.strip())

    body_lines = lines[closing_index + 1 :]
    if body_lines and body_lines[0] == "":
        body_lines = body_lines[1:]
    body = "\n".join(body_lines)
    if raw.endswith("\n") and body:
        body += "\n"
    if not meta.get("id"):
        meta["id"] = str(uuid.uuid4())
    return meta, body


def extract_frontmatter_block(raw: str) -> str | None:
    """Return a verbatim leading frontmatter block, if present."""
    source_start = 1 if raw.startswith("\ufeff") else 0
    source = raw[source_start:]
    if not source.startswith(("---\n", "---\r\n", "---\r")):
        return None
    if source.startswith("---\r\n"):
        opening_length = 5
    else:
        opening_length = 4
    offset = source_start + opening_length
    for line in raw[offset:].splitlines(keepends=True):
        if line.rstrip("\r\n") == "---":
            return raw[: offset + 3]
        offset += len(line)
    return None


def atomic_write(target: Path, data: bytes) -> None:
    """Durably replace ``target`` without exposing a partially-written Page."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.parent / f".{target.name}.tmp-{uuid.uuid4().hex}"
    try:
        with open(temporary, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)
    try:
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        pass
