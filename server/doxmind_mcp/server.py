"""doXmind MCP server — exposes the workspace to external agents over stdio.

The server operates on a single configured workspace root
($DOXMIND_WORKSPACE_ROOT, else ~/Documents/doXmind) and confines every
agent-supplied path to it (S5). It imports the `core` facade directly, so it
runs as a standalone process with no desktop app or HTTP service (ADR 0010).

The surface covers reads (list / search / read / read_pdf / read_excel),
writes (create / edit), structure (rename / move / delete / create_folder /
import), and export — all on the same `core` facade.
"""

# NOTE: do not add `from __future__ import annotations` here. FastMCP derives
# each tool's input schema from the parameter annotations and runs
# `issubclass(annotation, Context)` on them; with stringized annotations that
# raises `TypeError: issubclass() arg 1 must be a class`. Real (evaluated)
# annotations keep tool registration working across mcp SDK versions.
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from core import convert, documents, exporting, structure, workspace
from core.workspace import resolve_in_root

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
    """Read a Markdown Page. `path` is relative to the workspace root.

    Returns the source-backed Page read model: markdown, meta, revision, and
    outline.
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


@mcp.tool()
def create_document(path: str, markdown: str = "", title: str = "") -> dict[str, Any]:
    """Create a new markdown document. `path` is relative to the workspace root.

    Refuses to overwrite an existing document.
    """
    meta = {"title": title} if title else None
    return documents.create_document(None, path, markdown=markdown, meta=meta)


@mcp.tool()
def edit_document(path: str, markdown: str) -> dict[str, Any]:
    """Replace the markdown body of a workspace document (creates it if absent).

    `path` is relative to the workspace root.
    """
    return documents.edit_document(None, path, markdown)


@mcp.tool()
def export_document(path: str, format: str = "html", out_path: str = "") -> dict[str, Any]:
    """Export a workspace document to html/md, writing it into the workspace.

    `path` and `out_path` are relative to the workspace root. When `out_path` is
    omitted the output goes next to the source with the format's extension.
    Returns the output path and byte size.
    """
    source = resolve_in_root(None, path)
    out_rel = out_path or str(Path(path).with_suffix(exporting.suffix_for(format)))
    target = resolve_in_root(None, out_rel)
    if target.resolve(strict=False) == source.resolve(strict=True):
        raise ValueError("export would overwrite the source; pass a distinct out_path")
    if target.exists() or target.is_symlink():
        raise FileExistsError(f"export target already exists: {out_rel}")
    data = exporting.export_document_in_root(None, path, format)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as output:
        output.write(data)
    return {"outPath": out_rel, "bytes": len(data)}


@mcp.tool()
def rename_document(path: str, new_path: str) -> dict[str, Any]:
    """Rename an Attachment in place.

    Both paths are relative to the workspace root. Preserved legacy recovery
    artifacts travel byte-for-byte with their source when present. Markdown
    Page and Folder targets fail closed because they require desktop link-impact
    preview and transactional repair.
    """
    return structure.rename_document(None, path, new_path)


@mcp.tool()
def move_document(path: str, new_path: str) -> dict[str, Any]:
    """Move an Attachment to a new workspace location.

    Both paths are relative to the workspace root. Markdown Page and Folder
    targets fail closed until this surface can present the same relocation plan.
    """
    return structure.move_document(None, path, new_path)


@mcp.tool()
def delete_document(path: str) -> dict[str, Any]:
    """Move a document to the system Trash. Not a hard delete.

    `path` is relative to the workspace root. Any existing legacy recovery
    artifact family is moved with the source; no artifact is created.
    """
    return structure.delete_document(None, path)


@mcp.tool()
def create_folder(path: str) -> dict[str, Any]:
    """Create a folder in the workspace. `path` is relative to the workspace root."""
    return structure.create_folder(None, path)


@mcp.tool()
def import_document(
    source_path: str, dest_folder: str = "", name: str = "", mode: str = "create"
) -> dict[str, Any]:
    """Copy a .md/.pdf/.xlsx file to another location in the workspace.

    Both `source_path` and `dest_folder` are relative to the workspace root —
    the source must already be inside the workspace (agents cannot import files
    from outside it). `mode` is "create" (refuse to clobber) or "replace".
    """
    return structure.import_document(
        None, source_path, dest_folder, name, mode, confine_source=True
    )


@mcp.resource("docs://list")
def docs_index() -> str:
    """A markdown listing of every workspace document (resource URI, type, path)."""
    docs = workspace.list_workspace()["documents"]
    lines = [f"- doc:///{d['id']} [{d['documentType']}] {d['path']}" for d in docs]
    return "\n".join(lines) or "(empty workspace)"


# The id is placed in the URI path (doc:///<id>), not the authority (doc://<id>),
# because path-based ids look like "path:<hex>" and a colon in the authority is
# parsed as a port, which rejects the URI.
@mcp.resource("doc:///{doc_id}")
def doc_resource(doc_id: str) -> str:
    """The Markdown source of a Page addressed by its stable id.

    For Attachments, returns read-only guidance instead of invoking the Page
    reader.
    """
    dto = workspace.find_document(None, doc_id)
    if dto is None:
        raise ValueError(f"no document with id {doc_id}")
    if dto["documentType"] == "markdown":
        return documents.read_document_in_root(None, dto["path"])["markdown"]
    if dto["documentType"] == "html":
        return f"html Attachment at {dto['path']} — read-only in doXmind; open it externally."
    return (
        f"{dto['documentType']} Attachment at {dto['path']} — "
        f"use the read_{dto['documentType']} tool to parse it."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
