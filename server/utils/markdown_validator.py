"""Lightweight markdown validation for agent-edited content.

Checks for common syntax issues in tables, mermaid diagrams, math expressions,
and code blocks. Returns warnings with the actual problematic text so the agent
can use str_replace_editor to fix them directly (no line numbers).
"""

import re
from difflib import get_close_matches

# Languages supported by lowlight 'common' preset + other popular ones
KNOWN_LANGUAGES = {
    # lowlight common preset
    "arduino",
    "bash",
    "c",
    "cpp",
    "csharp",
    "css",
    "diff",
    "go",
    "graphql",
    "ini",
    "java",
    "javascript",
    "json",
    "kotlin",
    "less",
    "lua",
    "makefile",
    "markdown",
    "objectivec",
    "perl",
    "php",
    "php-template",
    "plaintext",
    "python",
    "python-repl",
    "r",
    "ruby",
    "rust",
    "scss",
    "shell",
    "sql",
    "swift",
    "typescript",
    "vbnet",
    "wasm",
    "xml",
    "yaml",
    # Common aliases
    "js",
    "ts",
    "py",
    "rb",
    "sh",
    "zsh",
    "yml",
    "html",
    "jsx",
    "tsx",
    "c++",
    "c#",
    "objective-c",
    "objc",
    # Other popular
    "scala",
    "haskell",
    "elixir",
    "erlang",
    "clojure",
    "dart",
    "zig",
    "toml",
    "dockerfile",
    "nginx",
    "http",
    "text",
    "txt",
    "csv",
    "powershell",
    "bat",
    "cmd",
    # Special - used by our editor
    "mermaid",
    "math",
    "latex",
    "katex",
}

# Mermaid diagram types that require -beta suffix
BETA_DIAGRAM_TYPES = {"xychart", "sankey", "architecture"}


def validate_markdown(text: str) -> list[str]:
    """Run all markdown validations, return list of warning strings.

    Warnings include the problematic text content so the agent can locate
    and fix issues using str_replace_editor(old_str=...).
    """
    warnings: list[str] = []
    warnings.extend(_check_tables(text))
    warnings.extend(_check_mermaid(text))
    warnings.extend(_check_math(text))
    warnings.extend(_check_code_blocks(text))
    return warnings


def _check_tables(text: str) -> list[str]:
    """Check markdown tables for column count consistency and separator rows."""
    warnings: list[str] = []
    lines = text.split("\n")
    table_lines: list[str] = []

    def _validate_table(table: list[str]) -> None:
        if len(table) < 2:
            return

        header_cols = table[0].strip().count("|") - 1
        if header_cols < 1:
            return

        # Check separator row (must be 2nd row)
        sep = table[1].strip()
        sep_inner = sep.strip("|").strip()
        if not re.match(r"^[\s\-:|]+$", sep_inner):
            warnings.append(
                f"Table missing separator row after header. "
                f"Expected '| --- | --- |' pattern after: '{table[0].strip()}'"
            )

        # Check column consistency
        for row in table[2:]:
            row_cols = row.strip().count("|") - 1
            if row_cols != header_cols:
                warnings.append(
                    f"Table column mismatch: row '{row.strip()}' "
                    f"has {row_cols} columns but header has {header_cols}"
                )

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            table_lines.append(line)
        else:
            if table_lines:
                _validate_table(table_lines)
                table_lines = []

    # Handle table at end of text
    if table_lines:
        _validate_table(table_lines)

    return warnings


def _check_mermaid(text: str) -> list[str]:
    """Check mermaid code blocks for common issues."""
    warnings: list[str] = []

    # Find all mermaid code blocks
    mermaid_pattern = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)
    matches = mermaid_pattern.findall(text)

    for block_content in matches:
        first_line = block_content.strip().split("\n")[0].strip() if block_content.strip() else ""

        # Check for beta diagram types without -beta suffix
        for dtype in BETA_DIAGRAM_TYPES:
            if first_line.lower().startswith(dtype) and not first_line.lower().startswith(
                f"{dtype}-beta"
            ):
                warnings.append(
                    f"Mermaid diagram type '{dtype}' requires '-beta' suffix. "
                    f"Use '{dtype}-beta' instead. Found in block starting with: '{first_line}'"
                )

    # Check for unclosed mermaid blocks
    opens = len(re.findall(r"```mermaid", text))
    # Count closing ``` after mermaid opens - approximate by checking paired blocks
    closed = len(mermaid_pattern.findall(text))
    if opens > closed:
        warnings.append(
            f"Unclosed mermaid code block detected ({opens} opens, {closed} closes). "
            f"Ensure every ```mermaid has a matching ```."
        )

    # If any mermaid content found, add skill reminder
    if matches:
        warnings.append(
            "Mermaid diagram detected. Use read_skill_instructions('charting') "
            "for syntax guidance if you haven't already."
        )

    return warnings


def _check_math(text: str) -> list[str]:
    """Check math expressions for unclosed delimiters."""
    warnings: list[str] = []

    # Check block math ($$...$$) - must be paired
    # Remove code blocks first to avoid false positives
    text_no_code = re.sub(r"```.*?```", "", text, flags=re.DOTALL)

    # Check block math
    block_math_count = text_no_code.count("$$")
    if block_math_count % 2 != 0:
        # Find the unpaired $$ and its context
        parts = text_no_code.split("$$")
        # Odd number of parts means odd number of $$ delimiters
        for i in range(len(parts) - 1):
            if i % 2 == 1:  # Inside a math block
                continue
            # Look for the $$ that opens but doesn't close
        warnings.append(
            f"Unclosed block math ($$) detected: found {block_math_count} "
            f"$$ delimiters (should be even). Check that every $$ has a closing $$."
        )

    # Check inline math ($...$) - exclude $$ and \$
    # Replace $$ with placeholder to avoid confusion
    text_for_inline = text_no_code.replace("$$", "\x00\x00")
    # Replace escaped \$ with placeholder
    text_for_inline = text_for_inline.replace("\\$", "\x01")

    # Count remaining single $
    dollar_count = text_for_inline.count("$")
    if dollar_count % 2 != 0:
        # Find context around the unpaired $
        idx = -1
        count = 0
        for i, ch in enumerate(text_for_inline):
            if ch == "$":
                count += 1
                if count == dollar_count:  # Last (unpaired) $
                    idx = i
                    break
        if idx >= 0:
            # Get surrounding context from original text
            start = max(0, idx - 30)
            end = min(len(text_for_inline), idx + 30)
            context = text_no_code[start:end].replace("\n", " ")
            warnings.append(
                f"Unclosed inline math ($) detected near: '...{context}...'. "
                f"Ensure every $ has a closing $."
            )
        else:
            warnings.append(
                f"Unclosed inline math ($) detected: found {dollar_count} "
                f"$ delimiters (should be even)."
            )

    return warnings


def _check_code_blocks(text: str) -> list[str]:
    """Check code blocks for closure and valid language identifiers."""
    warnings: list[str] = []

    # Find all code fence openings with optional language
    opens = list(re.finditer(r"```(\w[\w\-+#]*)?", text))
    # Pair them: odd-indexed are closers, even-indexed are openers
    if len(opens) % 2 != 0:
        # Find the last unclosed block
        last_open = opens[-1]
        snippet = text[last_open.start() : last_open.start() + 60].replace("\n", " ")
        warnings.append(f"Unclosed code block starting with: '{snippet}...'")

    # Check language identifiers on openers
    for i, match in enumerate(opens):
        if i % 2 != 0:
            continue  # Skip closing fences
        lang = match.group(1)
        if lang and lang.lower() not in KNOWN_LANGUAGES:
            close_matches = get_close_matches(lang.lower(), KNOWN_LANGUAGES, n=1, cutoff=0.6)
            suggestion = f" (did you mean '{close_matches[0]}'?)" if close_matches else ""
            snippet = text[match.start() : match.start() + 40].replace("\n", " ")
            warnings.append(
                f"Unknown code language '{lang}'{suggestion} in block starting with: '{snippet}'"
            )

    return warnings
