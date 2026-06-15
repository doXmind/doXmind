"""doXmind MCP server package (ADR 0010).

Named ``doxmind_mcp`` rather than ``mcp`` so it does not shadow the ``mcp`` SDK
on ``sys.path`` (the server runs with the backend directory as a top-level
import root).
"""
