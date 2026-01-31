"""Legal research tool executors.

This module contains the execution logic for legal tools:
- search_court_opinions: Search for cases
- get_court_opinion: Get full opinion text

All legal tools are async since they interact with external APIs.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Legal tool names for quick lookup
LEGAL_TOOL_NAMES = frozenset(["search_court_opinions", "get_court_opinion"])


def is_legal_tool(tool_name: str) -> bool:
    """Check if a tool is a legal tool that requires async execution."""
    return tool_name in LEGAL_TOOL_NAMES


async def execute_search_court_opinions(tool_input: dict[str, Any]) -> dict[str, Any]:
    """Execute search_court_opinions tool.

    Searches CourtListener for relevant court opinions.
    """
    query = tool_input.get("query", "")

    if not query:
        return {"error": "Search query is required."}

    # Import here to avoid circular imports and enable lazy loading
    from services.courtlistener_service import get_courtlistener_service

    try:
        service = get_courtlistener_service()

        if not service.is_configured():
            return {
                "error": "CourtListener API key not configured. Add COURTLISTENER_API_KEY to .env"
            }

        results = await service.search_opinions(
            query=query,
            court=tool_input.get("court"),
            filed_after=tool_input.get("filed_after"),
            filed_before=tool_input.get("filed_before"),
            cited_gt=tool_input.get("cited_gt"),
            cited_lt=tool_input.get("cited_lt"),
            semantic=tool_input.get("semantic", False),
            order_by=tool_input.get("order_by", "score desc"),
        )

        if not results["results"]:
            return {"result": f"No court opinions found for: '{query}'"}

        # Format results for readable output (compact format to save tokens)
        formatted = []
        for i, r in enumerate(results["results"], 1):
            # Limit to first 2 citations to reduce size
            citations = r["citation"][:2] if r["citation"] else []
            citation_str = ", ".join(citations) if citations else "No citation"
            if len(r["citation"]) > 2:
                citation_str += f" (+{len(r['citation']) - 2} more)"

            # Include opinion_id for get_court_opinion tool
            opinion_id = r.get("opinion_id", "N/A")

            formatted.append(
                f"**{i}. {r['case_name']}** ({r['court']}, {r['date_filed']})\n"
                f"   Citation: {citation_str} | Cited {r['citation_count']} times\n"
                f"   opinion_id: {opinion_id}\n"
                f"   {r['url']}"
            )

        header = f"Found {results['count']} opinions for '{query}':\n\n"
        footer = "\n\nUse get_court_opinion(opinion_id=<id>) to read full opinion text."
        return {"result": header + "\n\n".join(formatted) + footer}

    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"Legal search error: {e}")
        return {"error": f"Search failed: {str(e)}"}


async def execute_get_court_opinion(tool_input: dict[str, Any]) -> dict[str, Any]:
    """Execute get_court_opinion tool.

    Fetches the full text of a specific court opinion.
    """
    opinion_id = tool_input.get("opinion_id")

    if not opinion_id:
        return {"error": "opinion_id is required. Get it from search_court_opinions results."}

    # Import here to avoid circular imports
    from services.courtlistener_service import get_courtlistener_service

    try:
        service = get_courtlistener_service()

        if not service.is_configured():
            return {
                "error": "CourtListener API key not configured. Add COURTLISTENER_API_KEY to .env"
            }

        opinion = await service.get_opinion(opinion_id)

        # Format output
        output = f"**Opinion {opinion['opinion_id']}**\n"
        if opinion.get("author"):
            output += f"Author: {opinion['author']}\n"
        if opinion.get("type"):
            output += f"Type: {opinion['type']}\n"
        if opinion.get("per_curiam"):
            output += "Per Curiam: Yes\n"
        output += "\n---\n\n"
        output += opinion.get("text", "No text available.")

        return {"result": output}

    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"Get opinion error: {e}")
        return {"error": f"Failed to fetch opinion: {str(e)}"}


# Tool executor registry
_LEGAL_TOOL_EXECUTORS = {
    "search_court_opinions": execute_search_court_opinions,
    "get_court_opinion": execute_get_court_opinion,
}


async def execute_legal_tool(
    tool_name: str,
    tool_input: dict[str, Any],
) -> dict[str, Any]:
    """Execute a legal tool asynchronously.

    Args:
        tool_name: Name of the legal tool to execute
        tool_input: Tool input parameters

    Returns:
        Tool result dict with either 'result' or 'error'
    """
    executor = _LEGAL_TOOL_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown legal tool: {tool_name}"}

    return await executor(tool_input)
