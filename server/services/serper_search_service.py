"""Google Serper API service for web search functionality."""

import logging
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

SERPER_SEARCH_URL = "https://google.serper.dev/search"


async def serper_search(query: str, count: int = 10) -> list[dict[str, Any]]:
    """Search the web using Google Serper API.

    Args:
        query: Search query string
        count: Number of results to return (max 20)

    Returns:
        List of search results with title, url, snippet
    """
    settings = get_settings()
    api_key = settings.serper_api_key
    if not api_key:
        return [{"error": "Serper API key not configured"}]

    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    body = {
        "q": query,
        "num": min(count, 20),
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(SERPER_SEARCH_URL, headers=headers, json=body)
            response.raise_for_status()
            data = response.json()

        results = []

        # Extract knowledge graph if available
        kg = data.get("knowledgeGraph", {})
        if kg:
            snippet = kg.get("description", "")
            attributes = kg.get("attributes", {})
            if attributes:
                attr_text = " | ".join(f"{k}: {v}" for k, v in attributes.items())
                snippet += f"\n{attr_text}"
            results.append(
                {
                    "title": kg.get("title", ""),
                    "url": kg.get("website", ""),
                    "snippet": snippet,
                    "type": "knowledgeGraph",
                }
            )

        # Extract organic results
        for r in data.get("organic", []):
            results.append(
                {
                    "title": r.get("title", ""),
                    "url": r.get("link", ""),
                    "snippet": r.get("snippet", ""),
                }
            )

        return results

    except httpx.HTTPStatusError as e:
        logger.error(f"Serper API error: {e.response.status_code} - {e.response.text}")
        return [{"error": f"Search API error: {e.response.status_code}"}]
    except Exception as e:
        logger.error(f"Serper Search error: {e}")
        return [{"error": f"Search failed: {str(e)}"}]
