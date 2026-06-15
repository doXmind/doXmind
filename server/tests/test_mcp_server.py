"""S2 (ADR 0010): MCP server skeleton — read/search/list over the core facade.

`@mcp.tool()` returns the original function, so the tool callables can be driven
directly; one `call_tool` round-trip pins the registered dispatch path too.
"""

from pathlib import Path

import pytest

from doxmind_mcp import server


def _workspace(tmp_path: Path, monkeypatch) -> Path:
    (tmp_path / "alpha.md").write_text("# Alpha\n\nhello mcp world\n", encoding="utf-8")
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    return tmp_path


def test_read_document_tool_confined(tmp_path, monkeypatch):
    _workspace(tmp_path, monkeypatch)
    doc = server.read_document("alpha.md")
    assert "hello mcp world" in doc["markdown"]
    with pytest.raises(ValueError):
        server.read_document("../escape.md")


def test_search_and_list_tools(tmp_path, monkeypatch):
    _workspace(tmp_path, monkeypatch)
    hits = server.search_documents("mcp", 10)
    assert any(h["path"].endswith("alpha.md") for h in hits)
    listing = server.list_workspace()
    assert any(d["path"].endswith("alpha.md") for d in listing["documents"])


async def test_tools_registered():
    tools = await server.mcp.list_tools()
    names = {t.name for t in tools}
    assert {"list_workspace", "search_documents", "read_document"} <= names


async def test_call_tool_round_trip(tmp_path, monkeypatch):
    _workspace(tmp_path, monkeypatch)
    # A dict-returning tool yields the dict directly as the structured payload.
    _content, payload = await server.mcp.call_tool("read_document", {"path": "alpha.md"})
    assert "hello mcp world" in payload["markdown"]


async def test_doc_resource_by_id(tmp_path, monkeypatch):
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    from core.documents import create_document

    dto = create_document(tmp_path, "note.md", markdown="# Note\n\nresource body\n")

    templates = {t.uriTemplate for t in await server.mcp.list_resource_templates()}
    assert "doc://{doc_id}" in templates
    resources = {str(r.uri) for r in await server.mcp.list_resources()}
    assert "docs://list" in resources

    contents = await server.mcp.read_resource(f"doc://{dto['id']}")
    assert "resource body" in contents[0].content

    index = await server.mcp.read_resource("docs://list")
    assert "note.md" in index[0].content

    with pytest.raises(ValueError):
        await server.mcp.read_resource("doc://does-not-exist")
