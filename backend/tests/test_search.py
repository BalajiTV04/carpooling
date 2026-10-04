"""Module 8 tests: search retrieval (published/day/seats/radius/time).
Seeds trips directly (avoids repeating Module 6 gates). Run: pytest -q."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


@pytest.mark.asyncio
async def test_search_flow():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    phone = "+919000000801"
    await db.users.delete_many({"phone": phone})
    # Regex cleanup: other test files leave similarly-named trips behind.
    await db.trips.delete_many({"source.name": {"$regex": "^SearchTest"}})

    async with _client() as ac:
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234",
            "full_name": "Search User",
            "roles": ["driver", "passenger"]})).status_code == 201
        tok = (await ac.post("/api/v1/auth/login",
               json={"phone": phone, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me",
               headers=_h(tok))).json()["id"]
        # Isolated day (+2 days) so neighbouring test files can't collide.
        tomorrow = datetime.now(timezone.utc) + timedelta(days=2)
        day = tomorrow.strftime("%Y-%m-%d")
        depart = tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)
        src = {"name": "SearchTestSrc",
               "point": {"type": "Point", "coordinates": [77.5946, 13.0358]}}
        dst = {"name": "SearchTestDst",
               "point": {"type": "Point", "coordinates": [77.67, 12.8452]}}
        base = {"driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
                "source": src, "destination": dst, "route_geometry": None,
                "distance_km": 27.0, "duration_min": 48.0, "depart_at": depart,
                "seats_offered": 3, "seats_booked": 0,
                "status": "published",
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)}
        await db.trips.insert_one(dict(base))  # the match
        await db.trips.insert_one(dict(base, status="draft"))  # invisible
        full = dict(base)
        full["seats_booked"] = 3  # no seats left
        await db.trips.insert_one(full)
        far = dict(base)
        far["source"] = {"name": "SearchTestSrc",
                         "point": {"type": "Point", "coordinates": [72.8, 19.0]}}
        await db.trips.insert_one(far)  # Mumbai — outside radius

        q = {"src_coordinates": [77.5946, 13.0358],
             "dst_coordinates": [77.67, 12.8452],
             "date": day, "seats": 1}

        # 1. finds exactly the 1 good trip (draft/full/far excluded) + src/dst km
        r = await ac.post("/api/v1/search/rides", json=q, headers=_h(tok))
        assert r.status_code == 200, r.text
        assert r.json()["count"] == 1
        hit = r.json()["results"][0]
        assert hit["src_km"] == 0.0 and hit["dst_km"] == 0.0

        # 2. time inside ±2h matches; outside misses
        r2 = await ac.post("/api/v1/search/rides", headers=_h(tok),
                           json=dict(q, time="09:30"))
        assert r2.json()["count"] == 1
        r3 = await ac.post("/api/v1/search/rides", headers=_h(tok),
                           json=dict(q, time="15:00"))
        assert r3.json()["count"] == 0

        # 3. seats=4 exceeds 3 offered -> 0
        r4 = await ac.post("/api/v1/search/rides", headers=_h(tok),
                           json=dict(q, seats=4))
        assert r4.json()["count"] == 0

        # 4. wrong day -> 0; GET twin agrees with POST
        other = (tomorrow + timedelta(days=2)).strftime("%Y-%m-%d")
        r5 = await ac.post("/api/v1/search/rides", headers=_h(tok),
                           json=dict(q, date=other))
        assert r5.json()["count"] == 0
        g = await ac.get(
            "/api/v1/search/rides?src_lng=77.5946&src_lat=13.0358"
            "&dst_lng=77.67&dst_lat=12.8452&date=" + day,
            headers=_h(tok))
        assert g.status_code == 200 and g.json()["count"] == 1

        # 5. login required -> 401/403
        assert (await ac.post("/api/v1/search/rides", json=q)).status_code in (401, 403)

    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^SearchTest"}})
