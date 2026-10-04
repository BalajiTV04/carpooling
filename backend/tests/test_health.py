"""Module 1 smoke tests: importable app + health shape. No Mongo needed
(ping_db failure -> 'disconnected', still 200). Run: pytest -q (from backend/)."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_health_returns_ok_shape():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["db"] in ("connected", "disconnected")
    assert "routing_provider" in body


def test_v1_router_registered():
    paths = [r.path for r in app.routes]
    assert "/api/v1/health" in paths
