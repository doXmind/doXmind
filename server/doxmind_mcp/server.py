"""doXmind MCP server — exposes the workspace to external agents over stdio.

The server operates on a single configured workspace root
($DOXMIND_WORKSPACE_ROOT, else ~/Documents/doXmind) and confines every
agent-supplied path to it (S5). It imports the `core` facade directly, so it
runs as a standalone process with no desktop app or HTTP sidecar (ADR 0010).

S2 lands the read surface (list / search / read). Write and structural tools
arrive in later slices on the same `core` facade.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from core import convert, documents, workspace

mcp = FastMCP("doxmind")


@mcp.tool()
def list_workspace() -> dict[str, Any]:
    """List every document in the doXmind workspace (id, path, type, title)."""
    return workspace.list_workspace()


@mcp.tool()
def search_documents(query: str, limit: int = 50) -> list[dict[str, Any]]:
    """Full-text search markdown documents. Returns per-document line matches."""
    return workspace.search_documents(query=query, limit=limit)


@mcp.tool()
def read_document(path: str) -> dict[str, Any]:
    """Read a workspace document. `path` is relative to the workspace root.

    Returns the editor read model: markdown, html, meta, outline, and source
    state.
    """
    return documents.read_document_in_root(None, path)


@mcp.tool()
def read_pdf(path: str) -> dict[str, Any]:
    """Parse a workspace PDF into layout-aware paragraph blocks (text + bbox).

    `path` is relative to the workspace root.
    """
    return convert.read_pdf_in_root(None, path)


@mcp.tool()
def read_excel(path: str) -> dict[str, Any]:
    """Parse a workspace .xlsx/.xlsm into a JSON cell model.

    `path` is relative to the workspace root.
    """
    return convert.read_excel_in_root(None, path)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
