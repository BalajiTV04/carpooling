"""Module 9 tests: matching math (pure, no Mongo) + ranked search (live).

Pure tests use a synthetic straight route R = [(0,0) → (0.1,0)] (~11 km at
equator): deterministic, no network.
"""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.matching import match_fallback, match_trip, project_onto_route


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


ROUTE = [[0.0, 0.0], [0.05, 0.0], [0.1, 0.0]]  # straight east, ~11.1 km


def test_projection_midpoint():
    p = project_onto_route([0.05, 0.001], ROUTE)
    assert abs(p["frac"] - 0.5) < 0.02
    assert p["dist_km"] < 0.2


def test_full_ride_scores_high():
    m = match_trip(ROUTE, [0.0, 0.0], [0.1, 0.0], time_diff_min=0)
    assert m["feasible"] is True
    assert m["overlap_pct"] == 100.0
    assert m["score"] > 85


def test_short_hop_feasible_lower_score():
    full = match_trip(ROUTE, [0.0, 0.0], [0.1, 0.0], time_diff_min=0)
    hop = match_trip(ROUTE, [0.02, 0.0], [0.04, 0.0], time_diff_min=0)
    assert hop["feasible"] is True
    assert hop["overlap_pct"] < full["overlap_pct"]
    assert hop["score"] < full["score"]


def test_wrong_direction_rejected():
    m = match_trip(ROUTE, [0.08, 0.0], [0.02, 0.0])
    assert m["feasible"] is False
    assert "direction" in m["reason"]


def test_far_pickup_rejected():
    m = match_trip(ROUTE, [0.05, 0.05], [0.09, 0.0], max_pickup_km=3.0)
    assert m["feasible"] is False
    assert "pickup too far" in m["reason"]


def test_fallback_flags_unrouted():
    m = match_fallback([0.0, 0.0], [0.1, 0.0], [0.0, 0.0], [0.1, 0.0])
    assert m["feasible"] is True and m["routed"] is False


@pytest.mark.asyncio
async def test_ranked_search_flow():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    phone = "+919000000901"
    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^MatchTest"}})

    async with _client() as ac:
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234",
            "full_name": "Match User",
            "roles": ["driver", "passenger"]})).status_code == 201
        tok = (await ac.post("/api/v1/auth/login",
               json={"phone": phone, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me",
               headers=_h(tok))).json()["id"]
        # Isolated day (+3 days) so neighbouring test files can't collide.
        depart = (datetime.now(timezone.utc) + timedelta(days=3)).replace(
            hour=3, minute=0, second=0, microsecond=0)
        day = depart.strftime("%Y-%m-%d")
        route = {"type": "LineString", "coordinates": [
            [77.5946, 13.0358], [77.62, 13.0], [77.65, 12.92], [77.67, 12.8452]]}
        base = {"driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
                "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
                "seats_offered": 3, "seats_booked": 0, "status": "published",
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)}
        good = dict(base,
                    source={"name": "MatchTest A", "point": {"type": "Point",
                            "coordinates": [77.5946, 13.0358]}},
                    destination={"name": "MatchTest B", "point": {"type": "Point",
                                 "coordinates": [77.67, 12.8452]}},
                    route_geometry=route)
        await db.trips.insert_one(good)
        # wrong-direction trip: same endpoints swapped — fails forward gate.
        # (radius pre-filter still passes since endpoints are near.)
        rev = dict(base,
                   source={"name": "MatchTest B", "point": {"type": "Point",
                           "coordinates": [77.67, 12.8452]}},
                   destination={"name": "MatchTest A", "point": {"type": "Point",
                                "coordinates": [77.5946, 13.0358]}},
                   route_geometry={"type": "LineString", "coordinates": list(
                       reversed(route["coordinates"]))})
        await db.trips.insert_one(rev)
        q = {"src_coordinates": [77.5946, 13.0358],
             "dst_coordinates": [77.67, 12.8452],
             "date": day, "seats": 1, "include_excluded": True,
             # Wide radius so the wrong-direction trip survives the coarse
             # pre-filter and reaches the matcher (that's what we're testing).
             "radius_km": 40.0, "time": "03:00"}

        r = await ac.post("/api/v1/search/rides", json=q, headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        hit = body["results"][0]
        assert hit["match"]["feasible"] is True
        assert hit["match"]["overlap_pct"] > 80
        assert hit["match"]["routed"] is True
        assert body["excluded_count"] == 1
        assert "direction" in body["excluded"][0]["reason"]

    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^MatchTest"}})
