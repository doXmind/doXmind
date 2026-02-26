"""Community tool executors.

Provides tools to interact with the community platform:
- search_community: Search published documents
- fork_community_document: Fork a document to user's workspace
- get_community_recommendations: Get personalized recommendations

These tools call CommunityService methods directly.
"""

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from agents.tools.definitions import COMMUNITY_TOOL_NAMES

logger = logging.getLogger(__name__)


def is_community_tool(tool_name: str) -> bool:
    """Check if a tool is a community tool."""
    return tool_name in COMMUNITY_TOOL_NAMES


async def _exec_search_community(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Search published documents in the community."""
    from services.community_service import CommunityService

    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]

    query = tool_input.get("query", "")
    sort = tool_input.get("sort", "popular")
    tag = tool_input.get("tag")
    limit = min(tool_input.get("limit", 10), 20)

    try:
        service = CommunityService(db)
        items, total = await service.discover(
            sort=sort,
            tag=tag,
            search=query if query else None,
            limit=limit,
            offset=0,
            current_user_id=user_id,
        )

        if not items:
            msg = "No community documents found"
            if query:
                msg += f" for '{query}'"
            return {"result": msg}

        formatted = []
        for i, item in enumerate(items, 1):
            title = item.get("title", "Untitled")
            description = item.get("description", "")
            tags = item.get("tags", [])
            share_token = item.get("share_token", "")
            views = item.get("view_count", 0)
            forks = item.get("fork_count", 0)
            author = item.get("author", {}).get("username", "Unknown")

            tags_str = f" [{', '.join(tags)}]" if tags else ""
            desc_str = f"\n  {description[:200]}" if description else ""

            formatted.append(
                f"**{i}. {title}**{tags_str} by {author}\n"
                f"  share_token={share_token}, {views} views, {forks} forks{desc_str}"
            )

        header = f"Found {total} community document(s)"
        if query:
            header += f" matching '{query}'"
        return {"result": f"{header}:\n\n" + "\n\n".join(formatted)}

    except Exception as e:
        logger.error(f"Community search error: {e}")
        return {"error": f"Community search failed: {str(e)}"}


async def _exec_fork_document(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Fork a community document to the user's workspace."""
    from services.community_service import CommunityService

    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]

    share_token = tool_input.get("share_token", "")
    target_folder_id = tool_input.get("target_folder_id")

    if not share_token:
        return {"error": "share_token is required."}

    try:
        service = CommunityService(db)
        fork, file = await service.fork_share(
            share_token=share_token,
            user_id=user_id,
            target_folder_id=target_folder_id,
        )

        return {
            "result": (
                f"Forked document to your workspace:\n"
                f"- Name: {file.name}\n"
                f"- File ID: {file.id}\n"
                f"- Fork ID: {fork.id}"
            )
        }

    except Exception as e:
        logger.error(f"Community fork error: {e}")
        return {"error": f"Fork failed: {str(e)}"}


async def _exec_get_recommendations(
    tool_input: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    """Get personalized community recommendations."""
    from services.community_service import CommunityService

    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]

    limit = min(tool_input.get("limit", 10), 20)

    try:
        service = CommunityService(db)
        items, total = await service.get_recommendations(
            user_id=user_id,
            limit=limit,
            offset=0,
        )

        if not items:
            return {
                "result": "No recommendations available yet. Try exploring the community first."
            }

        formatted = []
        for i, item in enumerate(items, 1):
            title = item.get("title", "Untitled")
            description = item.get("description", "")
            tags = item.get("tags", [])
            share_token = item.get("share_token", "")
            author = item.get("author", {}).get("username", "Unknown")

            tags_str = f" [{', '.join(tags)}]" if tags else ""
            desc_str = f"\n  {description[:200]}" if description else ""

            formatted.append(
                f"**{i}. {title}**{tags_str} by {author}\n  share_token={share_token}{desc_str}"
            )

        return {"result": f"Recommended for you ({total} total):\n\n" + "\n\n".join(formatted)}

    except Exception as e:
        logger.error(f"Community recommendations error: {e}")
        return {"error": f"Failed to get recommendations: {str(e)}"}


_COMMUNITY_EXECUTORS = {
    "search_community": _exec_search_community,
    "fork_community_document": _exec_fork_document,
    "get_community_recommendations": _exec_get_recommendations,
}


async def execute_community_tool(
    tool_name: str, tool_input: dict[str, Any], community_context: dict[str, Any] | None
) -> dict[str, Any]:
    """Execute a community tool.

    Args:
        tool_name: Name of the tool
        tool_input: Tool input parameters
        community_context: {"db": AsyncSession, "user_id": str}
    """
    if not community_context:
        return {"error": "Community context not available."}

    executor = _COMMUNITY_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown community tool: {tool_name}"}

    return await executor(tool_input, community_context)
