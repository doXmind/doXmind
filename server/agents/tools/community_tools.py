"""Community tool stubs — disabled in local desktop edition."""

from typing import Any


def is_community_tool(tool_name: str) -> bool:  # noqa: ARG001
    return False


async def execute_community_tool(
    tool_name: str,  # noqa: ARG001
    tool_input: dict[str, Any],  # noqa: ARG001
    community_context: dict[str, Any] | None,  # noqa: ARG001
) -> dict[str, Any]:
    return {"error": "Community tools are disabled in the local desktop edition."}
