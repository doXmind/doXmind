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
    # YAML's flow sequence is only JSON when every item happens to be quoted. ``tags: [a, b]``
    # is ordinary YAML and was landing in the fallback as the literal string "[a, b]".
    if token.startswith("[") and token.endswith("]"):
        items = split_yaml_flow_items(token[1:-1])
        if items is not None:
            return [parse_yaml_scalar(item) for item in items]
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


def split_yaml_flow_items(inner: str) -> list[str] | None:
    """Top-level commas of a flow sequence's interior, respecting quotes and nesting."""
    items: list[str] = []
    current = ""
    quote: str | None = None
    escaped = False
    depth = 0
    for char in inner:
        if quote == '"':
            current += char
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quote = None
            continue
        if quote == "'":
            current += char
            if char == "'":
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
            current += char
            continue
        if char in {"[", "{"}:
            depth += 1
        elif char in {"]", "}"}:
            depth -= 1
        if char == "," and depth == 0:
            items.append(current)
            current = ""
            continue
        current += char
    if quote is not None or depth != 0:
        return None
    items.append(current)
    return [item.strip() for item in items if item.strip()]


_BLOCK_SEQUENCE_ENTRY = re.compile(r"^([ \t]*)-(?:[ \t]+(.*))?$")
_MAPPING_KEY = re.compile(r"^([A-Za-z_][A-Za-z0-9_.-]*)\s*:")


def read_block_sequence(lines: list[str], index: int) -> tuple[list[Any], int, str] | None:
    """The block sequence opened by ``lines[index]``, or None if the value is not one.

    ``tags:`` followed by ``  - project`` is how Obsidian writes a list, and reading only the
    key's own line saw an empty scalar — so every tag and alias in an imported vault arrived as
    ``""``, invisible in the properties panel and unpatchable by the writer. A nested *mapping*
    is deliberately not a sequence: those stay opaque, because the writer cannot target a key
    inside one.
    """
    match = _MAPPING_KEY.match(lines[index])
    if match is None:
        return None
    if _strip_yaml_inline_comment(lines[index][match.end() :]).strip():
        return None
    items: list[Any] = []
    indent: str | None = None
    end = index + 1
    while end < len(lines):
        entry = _BLOCK_SEQUENCE_ENTRY.match(lines[end])
        if entry is None:
            break
        # Every entry of one sequence stands in the same column; a different one is another node.
        if indent is None:
            indent = entry.group(1)
        elif entry.group(1) != indent:
            break
        items.append(parse_yaml_scalar((entry.group(2) or "").strip()))
        end += 1
    if not items:
        return None
    return items, end, indent if indent is not None else "  "


def parse_frontmatter(raw: str) -> tuple[dict[str, Any], str]:
    source = raw.removeprefix("\ufeff")
    if extract_frontmatter_block(raw) is None:
        return {"id": str(uuid.uuid4())}, raw
    lines = source.splitlines()
    if not lines or lines[0] != "---":
        return {"id": str(uuid.uuid4())}, raw

    closing_index = next(
        (index for index, line in enumerate(lines[1:], start=1) if line in ("---", "...")),
        None,
    )
    if closing_index is None:
        return {"id": str(uuid.uuid4())}, raw

    meta: dict[str, Any] = {}
    metadata_lines = lines[1:closing_index]
    index = 0
    while index < len(metadata_lines):
        # Only a top-level mapping entry — the exact shape the patch writer can
        # target — becomes a Page property. Indented keys stay unknown-but-
        # preserved source so an edit never lands on a different YAML node.
        line = metadata_lines[index]
        match = _MAPPING_KEY.match(line)
        if match is None:
            index += 1
            continue
        sequence = read_block_sequence(metadata_lines, index)
        if sequence is not None:
            items, end, _indent = sequence
            meta[match.group(1)] = items
            index = end
            continue
        meta[match.group(1)] = parse_yaml_scalar(line[match.end() :].strip())
        index += 1

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
        # `...` is YAML's document-end marker and a conventional frontmatter
        # terminator. Without it the scan runs past the block into body prose.
        if line.rstrip("\r\n") in ("---", "..."):
            return raw[: offset + 3]
        offset += len(line)
    return None


def atomic_write(target: Path, data: bytes) -> None:
    """Durably replace ``target`` without exposing a partially-written Page."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.parent / f".{target.name}.tmp-{uuid.uuid4().hex}"
    mode = target.stat().st_mode & 0o777 if target.exists() else 0o600
    try:
        with open(temporary, "wb") as handle:
            # The create mode is masked by the process umask, so preserving the
            # Page's permissions needs an explicit chmod before the replace.
            os.chmod(temporary, mode)
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
