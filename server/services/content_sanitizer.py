"""Content sanitizer for preventing UTF-8 encoding corruption in PostgreSQL.

Strips characters that PostgreSQL TEXT columns cannot safely store:
- Null bytes (\x00)
- Control characters (\x01-\x08, \x0b, \x0c, \x0e-\x1f)
- Lone surrogates (\ud800-\udfff)
- Unicode non-characters (\ufffe, \uffff)

Preserves: tab (\t), newline (\n), carriage return (\r), all valid Unicode.
"""

import logging
import re

logger = logging.getLogger(__name__)

# Match characters unsafe for PostgreSQL TEXT:
# \x00        — null byte (PG cannot store)
# \x01-\x08  — control chars (not valid in HTML content)
# \x0B       — vertical tab
# \x0C       — form feed
# \x0E-\x1F  — more control chars
# \uD800-\uDFFF — lone surrogates (invalid UTF-8)
# \uFFFE-\uFFFF — Unicode non-characters
_UNSAFE_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


def sanitize_content(content: str | None) -> str | None:
    """Remove characters that can corrupt PostgreSQL TEXT storage.

    Returns None if input is None, otherwise returns sanitized string.
    """
    if content is None:
        return None

    cleaned = _UNSAFE_PATTERN.sub("", content)

    if len(cleaned) != len(content):
        removed = len(content) - len(cleaned)
        logger.warning(
            "Sanitized %d unsafe character(s) from content (length %d -> %d)",
            removed,
            len(content),
            len(cleaned),
        )

    return cleaned
