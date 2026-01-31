"""CourtListener API service for legal case search.

This service provides access to the CourtListener API for searching
court opinions, enabling legal research within the writing assistant.

API Documentation: https://www.courtlistener.com/api/rest/v4/
"""

import logging
from functools import lru_cache
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)


class CourtListenerService:
    """Service for interacting with CourtListener API."""

    BASE_URL = "https://www.courtlistener.com/api/rest/v4"

    def __init__(self):
        self._api_key = get_settings().courtlistener_api_key

    def is_configured(self) -> bool:
        """Check if CourtListener API is configured."""
        return bool(self._api_key)

    async def search_opinions(
        self,
        query: str,
        court: str | None = None,
        filed_after: str | None = None,
        filed_before: str | None = None,
        cited_gt: int | None = None,
        cited_lt: int | None = None,
        semantic: bool = False,
        order_by: str = "score desc",
        page_size: int = 5,
    ) -> dict[str, Any]:
        """Search court opinions with optional semantic search.

        Args:
            query: Search query (keywords or legal concepts)
            court: Court filter (e.g., "scotus", "ca9", "nysd")
            filed_after: Date filter (YYYY-MM-DD format)
            filed_before: Date filter (YYYY-MM-DD format)
            cited_gt: Citation count greater than
            cited_lt: Citation count less than
            semantic: Enable AI-powered semantic search (default: False, requires paid plan)
            order_by: Sort order ("score desc", "dateFiled desc", "citeCount desc")
            page_size: Number of results (max 20)

        Returns:
            Dict with 'results' list and 'count' total
        """
        if not self.is_configured():
            raise ValueError("CourtListener API key is not configured")

        params = {
            "q": query,
            "type": "o",  # opinions
            "order_by": order_by,
            "page_size": min(page_size, 20),
        }

        # Semantic search requires paid plan
        if semantic:
            params["semantic"] = "true"

        # Add optional filters
        if court:
            params["court"] = court
        if filed_after:
            params["filed_after"] = filed_after
        if filed_before:
            params["filed_before"] = filed_before
        if cited_gt is not None:
            params["cited_gt"] = cited_gt
        if cited_lt is not None:
            params["cited_lt"] = cited_lt

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.get(
                    f"{self.BASE_URL}/search/",
                    params=params,
                    headers={
                        "Authorization": f"Token {self._api_key}",
                        "Accept": "application/json",
                        "User-Agent": "doXmind/1.0 (Legal Research Tool)",
                    },
                )

                if response.status_code == 401:
                    logger.error("CourtListener API authentication failed")
                    raise ValueError("Invalid CourtListener API key")

                if response.status_code != 200:
                    logger.error(
                        f"CourtListener API error: {response.status_code} - {response.text}"
                    )
                    raise ValueError(f"CourtListener API error: {response.status_code}")

                data = response.json()
                return self._format_search_results(data, max_results=page_size)

        except httpx.TimeoutException:
            logger.error("CourtListener API request timed out")
            raise ValueError("Search request timed out. Try a more specific query.")
        except httpx.RequestError as e:
            logger.error(f"CourtListener API request failed: {e}")
            raise ValueError(f"Failed to connect to CourtListener: {str(e)}")

    def _format_search_results(self, data: dict, max_results: int = 5) -> dict[str, Any]:
        """Format API response for tool output.

        Args:
            data: Raw API response
            max_results: Maximum results to return (API may return more)
        """
        results = []

        # Limit results since CourtListener API may ignore page_size
        for item in data.get("results", [])[:max_results]:
            # Extract first opinion ID for get_court_opinion tool
            opinions = item.get("opinions", [])
            opinion_id = opinions[0].get("id") if opinions else None

            results.append(
                {
                    "case_name": item.get("caseName", "Unknown Case"),
                    "court": item.get("court", "Unknown Court"),
                    "date_filed": item.get("dateFiled", ""),
                    "citation": item.get("citation", []),
                    "citation_count": item.get("citeCount", 0),
                    "snippet": item.get("snippet", ""),
                    "url": f"https://www.courtlistener.com{item.get('absolute_url', '')}",
                    "docket_number": item.get("docketNumber", ""),
                    "opinion_id": opinion_id,
                    "cluster_id": item.get("cluster_id"),
                }
            )

        return {
            "results": results,
            "count": data.get("count", 0),
            "query": data.get("q", ""),
        }

    async def get_opinion(self, opinion_id: int) -> dict[str, Any]:
        """Get a single court opinion by ID.

        Args:
            opinion_id: The opinion ID from search results

        Returns:
            Dict with opinion details including full text
        """
        if not self.is_configured():
            raise ValueError("CourtListener API key is not configured")

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.get(
                    f"{self.BASE_URL}/opinions/{opinion_id}/",
                    headers={
                        "Authorization": f"Token {self._api_key}",
                        "Accept": "application/json",
                        "User-Agent": "doXmind/1.0 (Legal Research Tool)",
                    },
                )

                if response.status_code == 401:
                    raise ValueError("Invalid CourtListener API key")
                if response.status_code == 404:
                    raise ValueError(f"Opinion not found: {opinion_id}")
                if response.status_code != 200:
                    raise ValueError(f"CourtListener API error: {response.status_code}")

                data = response.json()
                return self._format_opinion(data)

        except httpx.TimeoutException:
            raise ValueError("Request timed out while fetching opinion.")
        except httpx.RequestError as e:
            raise ValueError(f"Failed to connect to CourtListener: {str(e)}")

    def _format_opinion(self, data: dict) -> dict[str, Any]:
        """Format opinion API response.

        The opinion text can be in different formats:
        - plain_text: Plain text version
        - html_with_citations: HTML with linked citations
        - html: Basic HTML
        """
        # Get the best available text format
        text = (
            data.get("plain_text")
            or data.get("html_with_citations")
            or data.get("html")
            or ""
        )

        # Clean HTML if present (basic strip)
        if "<" in text and ">" in text:
            import re
            text = re.sub(r"<[^>]+>", "", text)
            text = re.sub(r"\s+", " ", text).strip()

        # Truncate very long opinions (keep first 8000 chars to save context)
        max_length = 8000
        if len(text) > max_length:
            text = text[:max_length] + f"\n\n[...truncated, full opinion has {len(text)} characters]"

        return {
            "opinion_id": data.get("id"),
            "author": data.get("author_str", ""),
            "type": data.get("type", ""),
            "download_url": data.get("download_url", ""),
            "text": text,
            "per_curiam": data.get("per_curiam", False),
        }


@lru_cache
def get_courtlistener_service() -> CourtListenerService:
    """Get the CourtListener service singleton."""
    return CourtListenerService()
