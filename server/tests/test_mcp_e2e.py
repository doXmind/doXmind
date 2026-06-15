"""End-to-end MCP test: drives the server through a real client session over
the in-memory transport (initialize handshake -> list_tools -> call_tool ->
read_resource). This exercises the actual JSON-RPC protocol path, not just the
tool callables.

Side effects are asserted on disk, which is robust across SDK result shapes.
"""

from mcp.shared.memory import create_connected_server_and_client_session

from doxmind_mcp import server


def _texts(contents) -> str:
    return " ".join(getattr(c, "text", "") or "" for c in contents)


async def test_mcp_protocol_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))

    async with create_connected_server_and_client_session(server.mcp._mcp_server) as client:
        await client.initialize()

        tools = {t.name for t in (await client.list_tools()).tools}
        assert {"create_document", "read_document", "list_workspace", "delete_document"} <= tools

        created = await client.call_tool(
            "create_document", {"path": "e2e.md", "markdown": "# E2E\n\nclient body"}
        )
        assert created.isError is False
        assert (tmp_path / "e2e.md").exists()  # tool actually ran through the protocol

        read = await client.call_tool("read_document", {"path": "e2e.md"})
        assert read.isError is False
        assert "client body" in _texts(read.content)

        index = await client.read_resource("docs://list")
        assert "e2e.md" in _texts(index.contents)


async def test_mcp_protocol_import_confinement(tmp_path, monkeypatch):
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))

    async with create_connected_server_and_client_session(server.mcp._mcp_server) as client:
        await client.initialize()
        # An external absolute source must be refused over the protocol too.
        result = await client.call_tool("import_document", {"source_path": "/etc/hosts"})
        assert result.isError is True
        assert not (tmp_path / "hosts").exists()
