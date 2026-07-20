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
import os
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import markdown
from markdown.extensions import Extension
from markdown.inlinepatterns import SimpleTagInlineProcessor
from markdown.postprocessors import RawHtmlPostprocessor
from markdown.treeprocessors import Treeprocessor


class _GfmStrikethroughExtension(Extension):
    """GFM ``~~text~~`` → ``<del>text</del>``.

    python-markdown has no built-in strikethrough; without this the tildes
    stay literal while the marked and Rust importers emit ``<del>`` (#152).
    Priority 105 sits below backticks (190) so ``` `~~x~~` ``` stays code.
    """

    def extendMarkdown(self, md: markdown.Markdown) -> None:
        md.inlinePatterns.register(
            SimpleTagInlineProcessor(r"()~~(.+?)~~", "del"), "gfm_del", 105
        )


# Map a ``[!MARKER]`` alert label onto one of the editor's four callout types.
# Accepts doXmind's own names (what the serializer writes) plus the GFM alert
# set, so alerts authored on GitHub import as callouts too. Must stay in sync
# with `callout_type_for_alert` (Rust) and `CALLOUT_TYPE_BY_ALERT` (marked) —
# see docs/adr/0009 and conformance/.
_CALLOUT_TYPE_BY_ALERT = {
    "INFO": "info",
    "NOTE": "info",
    "IMPORTANT": "info",
    "TIP": "tip",
    "WARNING": "warning",
    "ERROR": "error",
    "CAUTION": "error",
}

_ALERT_MARKER_RE = re.compile(r"^[ \t]*\[!([A-Za-z]+)\][ \t]*(?:\r?\n|$)")


class _GfmAlertTreeprocessor(Treeprocessor):
    """``> [!TYPE]`` blockquote → the editor's callout node.

    The callout serializer emits GFM alert syntax; without the matching import
    it is write-only — a saved callout reopens as a plain blockquote with its
    type lost (#149).
    """

    def run(self, root: Any) -> None:
        for quote in root.iter("blockquote"):
            first = next(iter(quote), None)
            if first is None or first.tag != "p" or not first.text:
                continue
            match = _ALERT_MARKER_RE.match(first.text)
            if match is None:
                continue
            callout_type = _CALLOUT_TYPE_BY_ALERT.get(match.group(1).upper())
            if callout_type is None:
                continue
            body = first.text[match.end() :]
            if body or len(first):
                first.text = body
            else:
                quote.remove(first)
            quote.tag = "div"
            quote.set("data-callout-type", callout_type)


class _GfmAlertExtension(Extension):
    def extendMarkdown(self, md: markdown.Markdown) -> None:
        # After `inline` (20) so the paragraph's text is settled, before
        # `raw_html` (30) restores the sentinel-wrapped HTML stash.
        md.treeprocessors.register(_GfmAlertTreeprocessor(md), "gfm_alert", 25)


CUSTOM_BLOCK_PLACEHOLDER_RE = re.compile(
    r'^<!--\s*(?:pdf-block|excel-block)\s+id="[^"]+"\s+src="[^"]+".*?\s*-->(?:\n|$)'
)

HTML_COMMENT_BLOCK_RE = re.compile(r"^<!--(?:(?!-->)[\s\S])*-->$")


def _escape_for_attr(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


class _RawHtmlSentinelPostprocessor(RawHtmlPostprocessor):
    """Wrap each block-level raw-HTML block in a ``<div data-raw-html="…">``
    sentinel so the editor imports it as a single rawHtml atom node, kept
    byte-identical by source preservation, instead of flattening it into
    images/links. Block-level HTML comments get the parallel
    ``<div data-html-comment="…">`` sentinel — they render nothing, so without
    a node of their own they were dropped on import and lost on the next save.
    Inline raw HTML is left untouched. Mirrors the marked and Rust importers;
    see ``src/extensions/raw-html.ts`` and ``src/extensions/html-comment.ts``.
    """

    def run(self, text: str) -> str:
        """Restore stashed HTML, treating a comment as a node only at block level.

        ``isblocklevel`` cannot answer this: it inspects the tag name, and a
        comment has none, so it reports every comment as block level wherever it
        sits. python-markdown signals the placement itself — a standalone block
        occupies a whole paragraph in the intermediate text
        (``<p>PLACEHOLDER</p>``) while an inline one appears bare. Wrapping an
        inline ``<!-- omit in toc -->`` in a div would split the heading that
        carries it and detach the marker from what it annotates, so inline
        comments are restored as their original text.
        """
        replacements: dict[str, str] = {}
        for i in range(self.md.htmlStash.html_counter):
            raw = str(self.md.htmlStash.rawHtmlBlocks[i])
            rendered = self.stash_to_string(raw)
            placeholder = self.md.htmlStash.get_placeholder(i)
            if self.isblocklevel(rendered):
                replacements[f"<p>{placeholder}</p>"] = rendered
            is_comment = bool(HTML_COMMENT_BLOCK_RE.match(raw.strip()))
            replacements[placeholder] = raw if is_comment else rendered

        if not replacements:
            return text

        def substitute_match(m: re.Match[str]) -> str:
            key = m.group(0)
            if key not in replacements:
                if key[3:-4] in replacements:
                    return f"<p>{replacements[key[3:-4]]}</p>"
                return key
            return replacements[key]

        base_placeholder = markdown.util.HTML_PLACEHOLDER % r"([0-9]+)"
        pattern = re.compile(f"<p>{base_placeholder}</p>|{base_placeholder}")
        processed = pattern.sub(substitute_match, text)
        return processed if processed == text else self.run(processed)

    def stash_to_string(self, text: object) -> str:
        html = str(text)
        head = html.lstrip()
        lower = head.lower()
        stripped = html.strip()
        # External-reference placeholders share the comment syntax but are owned
        # by the pdf-block / excel-block nodes, so they pass through verbatim.
        if HTML_COMMENT_BLOCK_RE.match(stripped) and not CUSTOM_BLOCK_PLACEHOLDER_RE.match(
            stripped
        ):
            return f'<div data-html-comment="{_escape_for_attr(stripped)}" data-type="html-comment"></div>'
        # Raw HTML owned by other blocks (comment placeholders, toggle,
        # columns) must pass through untouched.
        claimed = (
            head.startswith("<!--")
            or head.startswith("</")  # structural closing tag (columns/toggle close)
            or lower.startswith("<details")
            or lower.startswith("<pre")  # fenced code block — a CodeBlock node, not raw HTML
            or "data-column" in html
            # Any editor-owned node marker (task lists, etc.) is claimed by its
            # own parseHTML and must not be swallowed as a rawHtml passthrough.
            or "data-type=" in html
        )
        if not claimed and self.isblocklevel(stripped):
            raw = html.rstrip("\n")
            return f'<div data-raw-html="{_escape_for_attr(raw)}" data-type="raw-html"></div>'
        return html


# NOTE: Windows does not honor the POSIX leading-dot hidden convention, so
# `.foo.doxmind` sidecars show up next to user documents in Explorer. We
# considered flipping FILE_ATTRIBUTE_HIDDEN on every sidecar write, but
# Win32 `CreateFile` with `CREATE_ALWAYS` (which Python's `open(mode="w")`
# / `Path.write_text` lowers to) rejects existing files that carry the
# hidden bit with ERROR_ACCESS_DENIED. That would break legitimate external
# write paths (sync tools, manual edits, our own tests). Per-file hiding is
# therefore intentionally NOT applied. The workspace-level `.doxmind/`
# directory IS still hidden by the desktop runtime (Rust side) because
# directory hiding has no analogous overwrite problem.

SIDECAR_VERSION = 2
"""
Bumped 1 → 2 alongside the CJK math-content gate (ADR 0006). v1 sidecars
have a `html` field that may contain `<inline-math>` / `<block-math>` nodes
whose latex is CJK — false positives produced before the gate existed. We
treat any v1 sidecar as stale and rebuild HTML from the .md file (extras are
salvaged per Custom Block rules). Future schema changes that need to
invalidate the cached HTML follow the same lever.
"""

TASK_ITEM_RE = re.compile(r"^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$")


class SidecarReadResult:
    __slots__ = ()


@dataclass(frozen=True)
class Missing(SidecarReadResult):
    pass


@dataclass(frozen=True)
class Corrupt(SidecarReadResult):
    raw: bytes
    reason: str


@dataclass(frozen=True)
class Loaded(SidecarReadResult):
    data: dict[str, Any]


class CorruptSidecarError(Exception):
    def __init__(
        self,
        sidecar_path: Path,
        forensic_path: Path | None,
        reason: str,
    ) -> None:
        super().__init__(
            f"corrupt sidecar at {sidecar_path}: {reason}; forensic copy: {forensic_path}"
        )
        self.sidecar_path = sidecar_path
        self.forensic_path = forensic_path
        self.reason = reason


_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def close_unterminated_fence(md: str) -> str:
    """Append the closing marker for a code fence left open at end of document.

    CommonMark runs an unterminated fence to the end of the document, and both
    the marked and Rust importers do. python-markdown instead abandons the
    block and re-renders it as a paragraph, so every line collapses into one
    once TipTap parses that ``<p>`` — indentation and line breaks gone (#149).
    """
    marker: str | None = None
    for line in md.splitlines():
        match = _FENCE_RE.match(line)
        if not match:
            continue
        fence, info = match.group(1), match.group(2)
        if marker is None:
            # A backtick fence's info string may not contain a backtick.
            if fence[0] == "`" and "`" in info:
                continue
            marker = fence
        elif fence[0] == marker[0] and len(fence) >= len(marker) and not info.strip():
            marker = None
    if marker is None:
        return md
    return (md if md.endswith("\n") else md + "\n") + marker + "\n"


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


# ```mermaid fences must become the editor's mermaidChart atom node, not a
# plain code block — mirrors the marked importer (#152). The fenced_code
# extension has already HTML-escaped the payload (& < >), so only quotes
# need re-escaping for the attribute context; entities decode back to the
# original source when the editor reads `data-code`.
_MERMAID_FENCE_RE = re.compile(
    r'<pre><code class="language-mermaid">(.*?)</code></pre>', re.DOTALL
)


def _mermaid_fence_to_chart_div(rendered: str) -> str:
    def replace(match: re.Match[str]) -> str:
        code = match.group(1).rstrip("\n").replace('"', "&quot;")
        return (
            f'<div data-type="mermaid-chart" data-code="{code}"'
            ' class="mermaid-chart"></div>'
        )

    return _MERMAID_FENCE_RE.sub(replace, rendered)


def markdown_to_html(md: str) -> str:
    """Render markdown to HTML for the editor.

    No `codehilite` extension — TipTap can't parse the wrapper spans it
    emits; the frontend uses lowlight for syntax highlighting instead.

    `tab_length=2`: python-markdown only nests a sublist indented by exactly
    `tab_length` spaces, and both the TipTap serializer and CommonMark authors
    write 2-space nesting — the default (4) silently flattened those sublists
    into siblings (#152). Trade-off: indented code blocks now trigger at 2
    spaces instead of 4, and 4-space-indented sublists nest two levels deep.
    Our own save path only ever emits fenced code and 2-space lists, so both
    quirks are limited to externally-authored markdown, where a too-deep list
    beats losing the structure outright.
    """
    converter = markdown.Markdown(
        extensions=[
            "tables",
            "fenced_code",
            "sane_lists",
            _GfmStrikethroughExtension(),
            _GfmAlertExtension(),
        ],
        tab_length=2,
    )
    # Replace the built-in raw-HTML restorer with the sentinel-wrapping one
    # (same name + priority so it slots into the existing pipeline).
    converter.postprocessors.register(
        _RawHtmlSentinelPostprocessor(converter), "raw_html", 30
    )
    return _mermaid_fence_to_chart_div(
        converter.convert(render_task_lists(close_unterminated_fence(md)))
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


def extract_frontmatter_block(raw: str) -> str | None:
    """Verbatim frontmatter block (``---\\n...\\n---``, delimiters included, no
    trailing newline) at the start of ``raw``, or ``None`` if there is none.

    Byte-exact: never reorders, reserializes, or trims the head, so a
    hand-authored frontmatter (key order, comments, quoting) round-trips
    untouched. doXmind does not own the user's frontmatter (#148).
    """
    if not (raw.startswith("---\n") or raw.startswith("---\r\n")):
        return None
    nl = raw.find("\n")
    if nl == -1:
        return None
    offset = nl + 1
    for line in raw[offset:].splitlines(keepends=True):
        if line.rstrip("\r\n") == "---":
            return raw[: offset + 3]  # include the closing "---"
        offset += len(line)
    return None  # unterminated frontmatter — treat as no head


def assemble_md(head: str | None, body: str) -> str:
    """Assemble the ``.md``: a preserved head (if any) + a normalized body.
    Never injects a frontmatter block when ``head`` is ``None`` (#148)."""
    body = body.rstrip("\n")
    if head is not None:
        return f"{head}\n\n{body}\n" if body else f"{head}\n"
    return f"{body}\n" if body else ""


def read_sidecar(path: Path) -> SidecarReadResult:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return Missing()
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return Corrupt(raw=raw, reason=str(exc))
    if not isinstance(parsed, dict):
        return Corrupt(raw=raw, reason="sidecar JSON top level is not a dict")
    return Loaded(data=parsed)


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


def placeholder_re_for(block_types: tuple[str, ...]) -> re.Pattern[str]:
    """Compile the External-reference placeholder regex for `block_types`.

    Single source of truth for the canonical placeholder grammar
    (id-before-src; trailing `(?P<attrs>.*?)\\s*-->`). Empty `block_types`
    returns a never-matching pattern.
    """
    if not block_types:
        return re.compile(r"a\Ab")
    alternatives = "|".join(re.escape(block_type) for block_type in block_types)
    return re.compile(
        rf"<!--\s*(?P<block_type>{alternatives})\s+"
        r"id=\"(?P<id>[^\"]+)\"\s+"
        r"src=\"(?P<src>[^\"]+)\"(?P<attrs>.*?)\s*-->"
    )


def hash_markdown(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / f".{target.name}.tmp-{uuid.uuid4().hex}"
    try:
        # Single open: write, flush, fsync on the same handle. Windows
        # rejects ``os.fsync`` on an ``O_RDONLY`` descriptor with EBADF,
        # so the earlier write-then-reopen-readonly pattern was broken on
        # Windows. Doing the fsync on the writable handle is portable.
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        tmp.replace(target)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    # Directory fsync is a POSIX guarantee; Windows lacks an equivalent and
    # rejects opening a directory for read, so the try/except is the cross-
    # platform behavior — POSIX gets the durability boost, Windows no-ops.
    try:
        dir_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass
