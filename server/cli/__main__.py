"""Entry point for `doxmind` (and `python -m cli`)."""

from __future__ import annotations

import json
import os

import typer

app = typer.Typer(add_completion=False, help="doXmind local document toolkit.")


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
