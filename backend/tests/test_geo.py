"""Module 7 tests: routing service units (haversine/pure, no network) +
live geo endpoints (needs Mongo login; OSRM/Nominatim need internet —
assert SHAPE not values, with graceful fallback checks)."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


@pytest.mark.asyncio
async def test_geo_flow():
    from app.core.database import ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    from app.core.database import get_db

    db = get_db()
    phone = "+919000000701"
    await db.users.delete_many({"phone": phone})

    async with _client() as ac:
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234",
            "full_name": "Geo Test", "roles": ["passenger"]})).status_code == 201
        tok = (await ac.post("/api/v1/auth/login",
               json={"phone": phone, "password": "pass1234"})).json()["access_token"]

        # 1. search validation: too-short q -> 422
        assert (await ac.get("/api/v1/geo/search?q=ab",
                headers=_h(tok))).status_code == 422

        # 2. search real query -> list (may be [] offline; must be a list)
        s = await ac.get("/api/v1/geo/search?q=Hebbal%20Bengaluru&limit=3",
                         headers=_h(tok))
        assert s.status_code == 200, s.text
        assert isinstance(s.json(), list)

        # 3. reverse -> always 200 with lat/lng echoed (offline-safe fallback)
        r = await ac.get("/api/v1/geo/reverse?lat=13.0358&lng=77.5946",
                         headers=_h(tok))
        assert r.status_code == 200
        assert abs(r.json()["lat"] - 13.0358) < 0.001

        # 4. route preview -> geometry LineString + distance>0 (or fallback line)
        p = await ac.post("/api/v1/geo/route", headers=_h(tok), json={
            "src": [77.5946, 13.0358], "dst": [77.67, 12.8452]})
        assert p.status_code == 200, p.text
        body = p.json()
        assert body["geometry"]["type"] == "LineString"
        assert len(body["geometry"]["coordinates"]) >= 2
        assert body["distance_km"] > 0
        assert "routed" in body  # True = OSRM live, False = offline fallback

        # 5. geo needs login -> 401 without token
        assert (await ac.get("/api/v1/geo/search?q=Hebbal")).status_code in (401, 403)

    await db.users.delete_many({"phone": phone})


def test_route_cache_key_rounding():
    # pure check: cache helper behaviour via service import (no network)
    from app.services import routing as rs

    assert rs._round6([77.59461, 13.03581]) == "77.594610,13.035810"
