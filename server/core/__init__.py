"""Shell-agnostic operation facade for doXmind (ADR 0010).

The FastAPI routes, the `doxmind` CLI, and the MCP server all call into `core`
so the document/workspace operation vocabulary lives in exactly one place.
`core` runs against the filesystem directly. A Page is one Markdown file;
legacy `.doxmind` files are isolated recovery inputs, never Page state. No
running desktop app or HTTP service is required.
"""
