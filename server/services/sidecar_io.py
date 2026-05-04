"""Low-level sidecar I/O primitives.

Pure-stdlib helpers for reading/writing the markdown-shape `.doxmind`
sidecar wire format and the surrounding `.md` text. No knowledge of the
Document model, salvage rules, or Custom Block registry — those live in
`services.markdown_document_state` and `services.synthetic_document`,
both of which import from here.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import markdown

SIDECAR_VERSION = 1

TASK_ITEM_RE = re.compile(r"^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$")


def _render_task_item_text(text: str) -> str:
    rendered = markdown.markdown(text, extensions=["sane_lists"])
    if rendered.startswith("<p>") and rendered.endswith("</p>"):
        return rendered
    return f"<p>{html.escape(text)}</p>"


def render_task_lists(md: str) -> str:
    """Convert simple GitHub-style task list runs into TipTap task-list HTML."""
    lines = md.splitlines()
    output: list[str] = []
    index = 0

    while index < len(lines):
        match = TASK_ITEM_RE.match(lines[index])
        if not match:
            output.append(lines[index])
            index += 1
            continue

        indent = match.group(1)
        task_items: list[tuple[bool, str]] = []
        while index < len(lines):
            item_match = TASK_ITEM_RE.match(lines[index])
            if not item_match or item_match.group(1) != indent:
                break
            checked = item_match.group(2).lower() == "x"
            task_items.append((checked, item_match.group(3)))
            index += 1

        output.append('<ul data-type="taskList">')
        for checked, text in task_items:
            checked_attr = "true" if checked else "false"
            output.append(
                f'<li data-type="taskItem" data-checked="{checked_attr}">'
                f"{_render_task_item_text(text)}</li>"
            )
        output.append("</ul>")

    return "\n".join(output)


def markdown_to_html(md: str) -> str:
    """Render markdown to HTML for the editor.

    No `codehilite` extension — TipTap can't parse the wrapper spans it
    emits; the frontend uses lowlight for syntax highlighting instead.
    """
    return markdown.markdown(
        render_task_lists(md), extensions=["tables", "fenced_code", "sane_lists"]
    )


def parse_yaml_scalar(value: str) -> Any:
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value in {"null", "Null", "~"}:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value.strip("\"'")


def parse_frontmatter(raw: str) -> tuple[dict[str, Any], str]:
    if not raw.startswith("---"):
        return {"id": str(uuid.uuid4())}, raw
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return {"id": str(uuid.uuid4())}, raw

    closing_index = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            closing_index = index
            break
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


def build_md_with_frontmatter(meta: dict[str, Any], body: str) -> str:
    lines = []
    for key, value in meta.items():
        if value is None:
            continue
        if isinstance(value, bool):
            rendered = "true" if value else "false"
        elif isinstance(value, (int, float)):
            rendered = str(value)
        else:
            rendered = json.dumps(str(value), ensure_ascii=False)
        lines.append(f"{key}: {rendered}")
    trimmed_body = body.rstrip("\n")
    return f"---\n{chr(10).join(lines)}\n---\n\n{trimmed_body}\n"


def read_sidecar(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None


def sidecar_path_for(md_path: Path) -> Path:
    name = md_path.name
    lower = name.lower()
    if lower.endswith(".markdown"):
        stem = name[: -len(".markdown")]
    elif lower.endswith(".md"):
        stem = name[: -len(".md")]
    else:
        stem = name
    return md_path.parent / f".{stem}.doxmind"


def hash_markdown(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / f".{target.name}.tmp-{uuid.uuid4().hex}"
    tmp.write_bytes(data)
    tmp.replace(target)
