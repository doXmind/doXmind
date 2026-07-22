"""Markdown-only persistence for first-class Pages.

The Page file is the complete durable model.  This module deliberately knows
nothing about editor HTML, Page sidecars, or attachment recovery state.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from services.markdown_source import (
    atomic_write,
    extract_frontmatter_block,
    parse_frontmatter,
    portable_page_id_from_token,
)


@dataclass(frozen=True)
class MarkdownPage:
    """Source projection returned by :class:`MarkdownPageStore`."""

    markdown: str
    meta: dict[str, Any]
    revision: str


class PageRevisionConflictError(RuntimeError):
    """The Page changed after the caller's read and before its write."""

    def __init__(self, path: Path, expected: str, actual: str | None):
        self.path = path
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"page_revision_conflict: expected {expected}, actual {actual or 'missing'} for {path}"
        )


class MarkdownPageStore:
    """Persist a Page body without creating or updating hidden state."""

    def create(
        self,
        path: Path,
        page_id: str,
        markdown: str = "",
        meta: dict[str, Any] | None = None,
    ) -> None:
        _validate_page_path(path)
        if path.exists():
            raise FileExistsError(path)
        if not page_id.strip():
            raise ValueError("page id is required")
        if re.fullmatch(r"[A-Za-z0-9._:-]+", page_id) is None:
            raise ValueError("page id contains unsupported characters")

        frontmatter = {**(meta or {}), "id": page_id}
        _validate_page_property_patch_values(frontmatter)
        lines = [f"id: {page_id}"]
        for key, value in sorted(frontmatter.items()):
            if key == "id" or value is None:
                continue
            lines.append(f"{key}: {_render_metadata_value(key, value)}")
        rendered_lines = "\n".join(lines)
        content = f"---\n{rendered_lines}\n---\n"
        if markdown:
            content += f"\n{markdown}"
        encoded = content.encode("utf-8")
        atomic_write(path, encoded)

    def read(self, path: Path) -> MarkdownPage:
        _validate_page_path(path)

        encoded = path.read_bytes()
        raw = encoded.decode("utf-8")
        meta, _legacy_body = parse_frontmatter(raw)
        _prefix, body = _split_frontmatter_source(raw)
        head = extract_frontmatter_block(raw)
        source_id = _source_page_id(head)
        if source_id is None:
            # ``parse_frontmatter`` predates Markdown-only Pages and invents
            # an in-memory UUID when ``id`` is absent or empty. A source
            # projection exposes only a real non-empty string id so scans can
            # keep path identity without touching external frontmatter.
            meta.pop("id", None)
        else:
            meta["id"] = source_id
        meta = project_page_meta(meta)
        return MarkdownPage(markdown=body, meta=meta, revision=_revision_for_bytes(encoded))

    def write(
        self,
        path: Path,
        markdown: str,
        meta_patch: dict[str, Any] | None = None,
        expected_revision: str | None = None,
    ) -> str:
        _validate_page_path(path)

        existing_bytes = path.read_bytes() if path.exists() else None
        actual_revision = (
            _revision_for_bytes(existing_bytes) if existing_bytes is not None else None
        )
        if expected_revision is not None and expected_revision != actual_revision:
            raise PageRevisionConflictError(path, expected_revision, actual_revision)

        existing = existing_bytes.decode("utf-8") if existing_bytes is not None else None
        prefix = _split_frontmatter_source(existing)[0] if existing is not None else None
        if meta_patch:
            prefix = _patch_frontmatter_prefix(prefix, meta_patch)
        content = f"{prefix}{markdown}" if prefix is not None else markdown
        encoded = content.encode("utf-8")
        atomic_write(path, encoded)
        return _revision_for_bytes(encoded)


PAGE_PROPERTY_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]*$")
PAGE_LIST_METADATA_KEYS = frozenset({"tags", "aliases"})


def _source_page_id(frontmatter: str | None) -> str | None:
    if frontmatter is None:
        return None
    token: str | None = None
    for line in frontmatter.splitlines()[1:-1]:
        match = re.match(r"^\s*id\s*:\s*(.*?)\s*$", line)
        if match is not None:
            token = match.group(1)
    return portable_page_id_from_token(token) if token else None


def _revision_for_bytes(source: bytes) -> str:
    return f"sha256:{hashlib.sha256(source).hexdigest()}"


def project_page_meta(meta: dict[str, Any]) -> dict[str, Any]:
    projected = dict(meta)
    for key in ("id", "title", "icon", "cover", "created", "updated"):
        if key in projected and not isinstance(projected[key], str):
            projected.pop(key)
    if "favorite" in projected and not isinstance(projected["favorite"], bool):
        projected.pop("favorite")
    for key in PAGE_LIST_METADATA_KEYS:
        value = projected.get(key)
        if value is not None and (
            not isinstance(value, list) or not all(isinstance(item, str) for item in value)
        ):
            projected.pop(key)
    cover_position = projected.get("cover_position")
    if cover_position is not None and (
        isinstance(cover_position, bool) or not isinstance(cover_position, (int, float))
    ):
        projected.pop("cover_position")
    return projected


def _validate_page_path(path: Path) -> None:
    if not path.is_absolute():
        raise ValueError("page path must be absolute")
    if path.suffix.lower() not in {".md", ".markdown"}:
        raise ValueError(f"page path must end in .md or .markdown: {path}")


def _split_frontmatter_source(raw: str) -> tuple[str | None, str]:
    """Return a byte-stable frontmatter prefix and the exact Page body.

    The prefix includes the closing delimiter's line ending and, when present,
    one conventional blank separator line. Everything after that boundary is
    canonical Markdown source and is never newline-normalized or trimmed.
    """
    opening = re.match(r"\A(?:\ufeff)?---(?:\r\n|\n|\r)", raw)
    if opening is None:
        return None, raw

    offset = opening.end()
    for line in raw[offset:].splitlines(keepends=True):
        line_end = offset + len(line)
        if line.rstrip("\r\n") == "---":
            prefix_end = line_end
            # If the closing delimiter had a line ending, absorb exactly one
            # blank separator line. Additional blank lines remain Page source.
            if line.endswith(("\r", "\n")):
                tail = raw[prefix_end:]
                if tail.startswith("\r\n"):
                    prefix_end += 2
                elif tail.startswith(("\n", "\r")):
                    prefix_end += 1
            return raw[:prefix_end], raw[prefix_end:]
        offset = line_end

    return None, raw


def _render_yaml_scalar(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _render_metadata_value(key: str, value: Any) -> str:
    if key == "id":
        return str(value)
    return _render_yaml_scalar(value)


def _patch_frontmatter_prefix(prefix: str | None, meta_patch: dict[str, Any]) -> str | None:
    _validate_page_property_patch_values(meta_patch)
    patch = dict(sorted(meta_patch.items()))
    if not patch:
        return prefix

    if prefix is None:
        page_id = patch.get("id")
        if not isinstance(page_id, str) or not page_id.strip():
            page_id = str(uuid.uuid4())
        lines = [f"id: {page_id}"]
        for key, value in patch.items():
            if key != "id" and value is not None:
                lines.append(f"{key}: {_render_metadata_value(key, value)}")
        rendered_lines = "\n".join(lines)
        return f"---\n{rendered_lines}\n---\n\n"

    head = extract_frontmatter_block(prefix)
    if head is None:
        raise ValueError("cannot patch malformed Page frontmatter")
    suffix = prefix[len(head) :]
    newline = "\r\n" if "\r\n" in head else "\r" if "\r" in head else "\n"
    lines = head.splitlines()
    _validate_page_property_patch_source(lines[1:-1], patch)
    output: list[str] = [lines[0]]
    consumed: set[str] = set()

    for line in lines[1:-1]:
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_.-]*)\s*:", line)
        key = match.group(1) if match else None
        if key is None or key not in patch:
            output.append(line)
            continue
        consumed.add(key)
        value = patch[key]
        if value is not None:
            output.append(_patch_page_property_line(line, key, value))

    for key, value in patch.items():
        if key not in consumed and value is not None:
            output.append(f"{key}: {_render_metadata_value(key, value)}")
    output.append(lines[-1])
    return newline.join(output) + suffix


def _validate_page_property_patch_values(patch: dict[str, Any]) -> None:
    for key, value in patch.items():
        if PAGE_PROPERTY_KEY.fullmatch(key) is None:
            raise ValueError(f"invalid Page property key '{key}'")
        if key == "id" and (
            not isinstance(value, str) or re.fullmatch(r"[A-Za-z0-9._:-]+", value.strip()) is None
        ):
            raise ValueError("id must be a portable non-empty string")
        if key in PAGE_LIST_METADATA_KEYS:
            if value is not None and (
                not isinstance(value, list) or not all(isinstance(item, str) for item in value)
            ):
                raise ValueError(f"{key} must be string[] or null")
            continue
        is_finite_number = (
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        )
        is_string_list = isinstance(value, list) and all(isinstance(item, str) for item in value)
        if value is not None and not (
            isinstance(value, (str, bool)) or is_finite_number or is_string_list
        ):
            raise ValueError(f"{key} must be a string, finite number, boolean, string[], or null")


def _validate_page_property_patch_source(lines: list[str], patch: dict[str, Any]) -> None:
    for key in patch:
        matches = [
            index for index, line in enumerate(lines) if _page_property_line_key(line) == key
        ]
        if len(matches) > 1:
            raise ValueError(f"cannot safely patch Page property '{key}': duplicate YAML keys")
        if len(matches) != 1:
            continue
        index = matches[0]
        line = lines[index]
        scalar = _strip_yaml_inline_comment(line.split(":", 1)[1]).strip()
        if scalar:
            continue
        for continuation in lines[index + 1 :]:
            if not continuation.strip() or continuation.lstrip().startswith("#"):
                continue
            if continuation.startswith((" ", "\t")):
                raise ValueError(f"cannot safely patch Page property '{key}': nested YAML value")
            break


def _page_property_line_key(line: str) -> str | None:
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_.-]*)\s*:", line)
    return match.group(1) if match else None


def _patch_page_property_line(line: str, key: str, value: Any) -> str:
    separator = line.index(":")
    prefix = line[: separator + 1]
    raw_value = line[separator + 1 :]
    leading_whitespace = raw_value[: len(raw_value) - len(raw_value.lstrip())]
    comment_index = _yaml_inline_comment_index(raw_value)
    suffix = ""
    if comment_index is not None:
        before_comment = raw_value[:comment_index]
        suffix = before_comment[len(before_comment.rstrip()) :] + raw_value[comment_index:]
    else:
        suffix = raw_value[len(raw_value.rstrip()) :]
    return f"{prefix}{leading_whitespace}{_render_metadata_value(key, value)}{suffix}"


def _strip_yaml_inline_comment(value: str) -> str:
    index = _yaml_inline_comment_index(value)
    return value if index is None else value[:index].rstrip()


def _yaml_inline_comment_index(value: str) -> int | None:
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
            return index
        index += 1
    return None
