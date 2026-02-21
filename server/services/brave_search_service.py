"""Brave Search API service for web search functionality."""

import logging
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


async def brave_search(query: str, count: int = 10) -> list[dict[str, Any]]:
    """Search the web using Brave Search API.

    Args:
        query: Search query string
        count: Number of results to return (max 20)

    Returns:
        List of search results with title, url, snippet
    """
    settings = get_settings()
    api_key = settings.brave_search_api_key
    if not api_key:
        return [{"error": "Brave Search API key not configured"}]

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }
    params = {
        "q": query,
        "count": min(count, 20),
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(BRAVE_SEARCH_URL, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()

        results = []
        web_results = data.get("web", {}).get("results", [])
        for r in web_results:
            results.append(
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("description", ""),
                    "age": r.get("age", ""),
                }
            )
        return results

    except httpx.HTTPStatusError as e:
        logger.error(f"Brave Search API error: {e.response.status_code} - {e.response.text}")
        return [{"error": f"Search API error: {e.response.status_code}"}]
    except Exception as e:
        logger.error(f"Brave Search error: {e}")
        return [{"error": f"Search failed: {str(e)}"}]
