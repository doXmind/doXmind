"""HTML is a read-only Attachment; old Sidecars remain recovery inputs."""

from __future__ import annotations

from pathlib import Path

import pytest

from api.workspace import (
    is_html_file,
    is_workspace_document_file,
    read_doc,
)
from services.legacy_sidecar import sidecar_path_for
from services.markdown_page_store import MarkdownPageStore


def test_html_extension_detection() -> None:
    assert is_html_file(Path("a.html")) and is_html_file(Path("a.htm"))
    assert is_workspace_document_file(Path("a.html"))
    assert not is_html_file(Path("a.md"))


def test_page_writer_rejects_html_without_changing_it(tmp_path: Path) -> None:
    p = tmp_path / "page.html"
    body = "<h1>Hi</h1>\n<p>x</p>"
    p.write_text(body, encoding="utf-8")

    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        MarkdownPageStore().write(p, "# changed", {"id": "h1"})

    assert p.read_text(encoding="utf-8") == body
    assert not sidecar_path_for(p).exists()


def test_page_reader_rejects_html_attachment(tmp_path: Path) -> None:
    p = tmp_path / "page.html"
    p.write_text("<h1>Attachment</h1>", encoding="utf-8")

    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        read_doc(p)


def test_write_doc_workspace_rejects_html_attachment(tmp_path: Path) -> None:
    from api.workspace import write_doc_workspace

    (tmp_path / "page.html").write_text("<p>old</p>", encoding="utf-8")
    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        write_doc_workspace(
            str(tmp_path),
            "page.html",
            {"html": "<h1>New</h1><p>body</p>", "markdown": "# ignored"},
        )

    assert (tmp_path / "page.html").read_text(encoding="utf-8") == "<p>old</p>"
