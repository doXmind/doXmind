"""Document section parser for agentic navigation.

Parses markdown documents into a navigable hierarchy of sections
with stable IDs, line ranges, and character counts. Enables the
writing agent to navigate documents without reading them entirely.
"""

import re
from dataclasses import dataclass, field

HEADER_RE = re.compile(r"^(#{1,6})\s+(.+)$")


@dataclass
class DocumentSection:
    """A navigable section of a markdown document."""

    section_id: str  # e.g. "s1", "s1.2", "s1.2.3"
    heading_level: int  # 1-6, or 0 for preamble
    heading_text: str  # e.g. "Introduction"
    start_line: int  # 1-indexed, inclusive
    end_line: int  # 1-indexed, inclusive
    content: str  # full markdown content of this section
    char_count: int  # len(content)
    children_ids: list[str] = field(default_factory=list)


def parse_sections(markdown: str) -> list[DocumentSection]:
    """Parse markdown into hierarchical sections based on headings.

    Each section spans from its heading line to just before the next heading
    at the same or higher level.  Content before the first heading becomes
    a preamble section with id ``s0``.

    Reading a parent section via ``find_sections`` includes all children.
    """
    lines = markdown.split("\n")
    if not lines:
        return []

    # First pass: locate all headings with their line numbers (1-indexed).
    headers: list[dict] = []
    for i, line in enumerate(lines):
        m = HEADER_RE.match(line)
        if m:
            headers.append({"level": len(m.group(1)), "text": m.group(2).strip(), "line": i + 1})

    # If no headings, return the whole document as a single section.
    if not headers:
        content = markdown
        return [
            DocumentSection(
                section_id="s0",
                heading_level=0,
                heading_text="(document)",
                start_line=1,
                end_line=len(lines),
                content=content,
                char_count=len(content),
            )
        ]

    sections: list[DocumentSection] = []

    # Preamble: content before the first heading.
    if headers[0]["line"] > 1:
        end = headers[0]["line"] - 1
        content = "\n".join(lines[0:end])
        if content.strip():
            sections.append(
                DocumentSection(
                    section_id="s0",
                    heading_level=0,
                    heading_text="(preamble)",
                    start_line=1,
                    end_line=end,
                    content=content,
                    char_count=len(content),
                )
            )

    # Second pass: build sections from headings.
    # Counter-per-level scheme: when encountering a heading at level N,
    # reset all counters deeper than N, then increment counter at N.
    # The section ID is built from counters at all levels up to N.
    counters: dict[int, int] = {}

    for idx, header in enumerate(headers):
        level = header["level"]
        start_line = header["line"]

        # End line: line before next header, or end of document.
        if idx + 1 < len(headers):
            end_line = headers[idx + 1]["line"] - 1
        else:
            end_line = len(lines)

        # Reset counters deeper than current level.
        for lv in list(counters.keys()):
            if lv > level:
                del counters[lv]

        # Increment counter at current level.
        counters[level] = counters.get(level, 0) + 1

        # Build section ID from counters at each level up to current.
        # e.g. counters={1:2, 2:1, 3:1} at level 3 → "s2.1.1"
        id_parts = [str(counters[lv]) for lv in sorted(counters.keys()) if lv <= level]
        section_id = "s" + ".".join(id_parts)

        content = "\n".join(lines[start_line - 1 : end_line])

        sections.append(
            DocumentSection(
                section_id=section_id,
                heading_level=level,
                heading_text=header["text"],
                start_line=start_line,
                end_line=end_line,
                content=content,
                char_count=len(content),
            )
        )

    # Third pass: populate children_ids.
    id_to_section = {s.section_id: s for s in sections}
    for sec in sections:
        if sec.section_id == "s0":
            continue
        # Parent is the closest ancestor in the ID hierarchy.
        # e.g. for "s1.2.3", parent is "s1.2"
        parts = sec.section_id.rsplit(".", 1)
        if len(parts) == 2:
            parent_id = parts[0]
            if parent_id in id_to_section:
                id_to_section[parent_id].children_ids.append(sec.section_id)

    return sections


def generate_outline(sections: list[DocumentSection], total_lines: int) -> str:
    """Generate a compact text outline from parsed sections.

    Returns a lightweight representation (~100-300 tokens) showing
    section IDs, line ranges, heading hierarchy, and estimated token counts.
    """
    out: list[str] = []
    out.append(f"Total: {total_lines} lines\n")

    for sec in sections:
        if sec.heading_level == 0:
            indent = ""
            prefix = "(preamble)"
        else:
            indent = "  " * (sec.heading_level - 1)
            prefix = "#" * sec.heading_level + " " + sec.heading_text

        est_tokens = sec.char_count // 4
        out.append(
            f"{indent}{sec.section_id}  [L{sec.start_line}-L{sec.end_line}]  {prefix}  (~{est_tokens} tok)"
        )

    return "\n".join(out)


def find_sections(sections: list[DocumentSection], section_ids: list[str]) -> list[DocumentSection]:
    """Find sections by ID. Reading a parent includes all its children.

    Returns sections in document order, deduplicated.
    """
    id_to_section = {s.section_id: s for s in sections}
    result_ids: set[str] = set()

    def _collect(sid: str) -> None:
        if sid in result_ids:
            return
        sec = id_to_section.get(sid)
        if not sec:
            return
        result_ids.add(sid)
        for child_id in sec.children_ids:
            _collect(child_id)

    for sid in section_ids:
        _collect(sid)

    # Return in document order.
    return [s for s in sections if s.section_id in result_ids]
