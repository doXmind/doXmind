"""Entry point for `doxmind` (and `python -m cli`)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import typer

app = typer.Typer(add_completion=False, help="doXmind local document toolkit.")
index_app = typer.Typer(help="Workspace index commands.")
app.add_typer(index_app, name="index")

ROOT_OPTION = typer.Option(
    None,
    "--root",
    help="Workspace root (defaults to $DOXMIND_WORKSPACE_ROOT or ~/Documents/doXmind).",
)


@app.command(name="ls")
def list_documents(
    root: str = ROOT_OPTION,
    as_json: bool = typer.Option(False, "--json", help="Print the scan result as JSON."),
) -> None:
    """List the documents in the workspace."""
    from core.workspace import list_workspace

    result = list_workspace(root)
    if as_json:
        typer.echo(json.dumps(result, ensure_ascii=False, indent=2))
        return
    for doc in result["documents"]:
        typer.echo(f"{doc['documentType']:<8} {doc['path']}")


@app.command()
def search(
    query: str = typer.Argument(..., help="Text to search for in markdown bodies."),
    root: str = ROOT_OPTION,
    limit: int = typer.Option(None, "--limit", help="Max documents to return."),
    as_json: bool = typer.Option(False, "--json", help="Print results as JSON."),
) -> None:
    """Full-text search markdown documents in the workspace."""
    from core.workspace import search_documents

    results = search_documents(root, query, limit)
    if as_json:
        typer.echo(json.dumps(results, ensure_ascii=False, indent=2))
        return
    for hit in results:
        typer.echo(f"{hit['path']} ({len(hit['matches'])} match(es))")
        for match in hit["matches"][:5]:
            typer.echo(f"  {match['line']}: {match['preview']}")


@index_app.command("rebuild")
def index_rebuild(root: str = ROOT_OPTION) -> None:
    """Rebuild the workspace id->path index."""
    from core.workspace import rebuild_index

    index = rebuild_index(root)
    typer.echo(f"rebuilt index: {len(index.get('ids', {}))} document(s)")


@app.command()
def read(
    path: str = typer.Argument(..., help="Path to the .md / .html document."),
    as_json: bool = typer.Option(False, "--json", help="Print the full read DTO as JSON."),
    html: bool = typer.Option(False, "--html", help="Print the editor HTML instead of markdown."),
) -> None:
    """Read a document and print its markdown (default), HTML, or full JSON."""
    from core.documents import read_document

    doc = read_document(path)
    if as_json:
        typer.echo(json.dumps(doc, ensure_ascii=False, indent=2))
    elif html:
        typer.echo(doc.get("html", ""))
    else:
        typer.echo(doc.get("markdown", ""))


@app.command()
def export(
    path: str = typer.Argument(..., help="Path to the document to export."),
    to: str = typer.Option("pdf", "--to", help="Export format: pdf, html, or md."),
    out: str = typer.Option(None, "--out", help="Output file (defaults next to the source)."),
) -> None:
    """Export a document to pdf, html, or md."""
    from core.exporting import export_document, suffix_for

    data = export_document(path, to)
    target = Path(out) if out else Path(path).with_suffix(suffix_for(to))
    if target.resolve() == Path(path).resolve():
        raise typer.BadParameter("export would overwrite the source; pass --out")
    target.write_bytes(data)
    typer.echo(f"wrote {target} ({len(data)} bytes)")


@app.command()
def convert(
    path: str = typer.Argument(..., help="Path to a .pdf or .xlsx/.xlsm file."),
) -> None:
    """Parse a PDF or Excel file into the editor's JSON model and print it."""
    from core.convert import convert_excel, convert_pdf

    suffix = Path(path).suffix.lower()
    if suffix == ".pdf":
        result = convert_pdf(path)
    elif suffix in {".xlsx", ".xlsm"}:
        result = convert_excel(path)
    else:
        raise typer.BadParameter("convert supports .pdf and .xlsx/.xlsm files")
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


@app.command()
def serve(
    port: int = typer.Option(8000, "--port", help="Port for the FastAPI sidecar."),
    host: str = typer.Option("127.0.0.1", "--host", help="Host to bind."),
) -> None:
    """Run the FastAPI sidecar (debugging aid)."""
    os.environ["HOST"] = host
    os.environ["PORT"] = str(port)
    from run_sidecar import main as run_sidecar_main

    run_sidecar_main()


def main() -> None:
    app()


if __name__ == "__main__":
    main()
