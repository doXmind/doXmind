"""
Tests for health check and root endpoints.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.unit
class TestHealthEndpoints:
    """Test health check and root endpoints."""

    async def test_root_endpoint(self, client: AsyncClient):
        """Test the root endpoint returns expected data."""
        response = await client.get("/")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "doXmind Mini API"
        assert data["version"] == "1.0.0"
        assert data["status"] == "running"

    async def test_health_check(self, client: AsyncClient):
        """Test the health check endpoint."""
        response = await client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
