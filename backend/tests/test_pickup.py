"""Module 10 tests: pickup optimiser (pure geometry) + live endpoint.

Pure tests keep everything deterministic: no network, no Mongo. The route is a
straight east line at the equator so ~1 deg lng ≈ 111 km.
"""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.pickup import optimise_pickup_point

ROUTE = [[0.0, 0.0], [0.05, 0.0], [0.1, 0.0]]  # ~11.1 km straight


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def test_pickup_optimiser_returns_chosen_and_reason():
    r = optimise_pickup_point(ROUTE, [0.03, 0.002], [0.09, 0.0])
    assert r["chosen"] is not None
    assert r["chosen"]["strategy"] in ("walk", "door")
    assert r["chosen"]["why"]
    assert r["considered"] > 1


def test_walk_mode_wins_when_door_is_far():
    # Door is 1 km off-route: walking 1 km costs 0.3, door detour is ~2 km.
    r = optimise_pickup_point(ROUTE, [0.03, 0.009], [0.09, 0.0], mode="auto")
    assert r["chosen"]["strategy"] == "walk"
    assert r["chosen"]["detour_km"] == 0.0


def test_door_mode_wins_when_passenger_is_close_to_route():
    # Door only ~55 m off-route: deviation is tiny, so door pickup is best.
    r = optimise_pickup_point(ROUTE, [0.03, 0.0005], [0.09, 0.0], mode="auto")
    assert r["chosen"]["strategy"] == "door"
    assert r["chosen"]["detour_km"] < 0.2


def test_forced_modes_respected():
    walk = optimise_pickup_point(ROUTE, [0.03, 0.0005], [0.09, 0.0], mode="walk")
    door = optimise_pickup_point(ROUTE, [0.03, 0.0005], [0.09, 0.0], mode="door")
    assert walk["chosen"]["detour_km"] == 0.0
    assert door["chosen"]["strategy"] == "door"


def test_candidate_never_past_dropoff():
    r = optimise_pickup_point(ROUTE, [0.02, 0.0], [0.04, 0.0], mode="walk")
    assert r["chosen"]["frac"] <= 0.4 + 1e-6


def test_no_geometry_and_wrong_direction_are_reported():
    assert optimise_pickup_point([], [0.0, 0.0], [0.1, 0.0])["chosen"] is None
    back = optimise_pickup_point(ROUTE, [0.09, 0.0], [0.02, 0.0])
    assert back["chosen"] is None
    assert "downstream" in back["reason"]


def test_savings_never_negative():
    r = optimise_pickup_point(ROUTE, [0.03, 0.004], [0.09, 0.0])
    assert r["saved_detour_km"] >= 0.0


@pytest.mark.asyncio
async def test_pickup_options_endpoint_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    phone = "+919000001001"
    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^PickupTest"}})

    async with _client() as ac:
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234",
            "full_name": "Pickup User",
            "roles": ["passenger"]})).status_code == 201
        tok = (await ac.post("/api/v1/auth/login",
               json={"phone": phone, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me", headers=_h(tok))).json()["id"]

        now = datetime.now(timezone.utc)
        route = {"type": "LineString", "coordinates": [
            [77.5946, 13.0358], [77.62, 13.0], [77.65, 12.92], [77.67, 12.8452]]}
        trip_id = (await db.trips.insert_one({
            "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
            "source": {"name": "PickupTest A",
                       "point": {"type": "Point", "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "PickupTest B",
                            "point": {"type": "Point", "coordinates": [77.67, 12.8452]}},
            "route_geometry": route, "distance_km": 30.0, "duration_min": 50.0,
            "depart_at": now + timedelta(days=4), "seats_offered": 3,
            "seats_booked": 0, "status": "published",
            "created_at": now, "updated_at": now,
        })).inserted_id

        # 1. optimiser runs, labels come back, trip context attached
        r = await ac.post(f"/api/v1/trips/{trip_id}/pickup-options", headers=_h(tok),
                          json={"pickup_coordinates": [77.60, 13.01],
                                "dropoff_coordinates": [77.67, 12.8452],
                                "mode": "auto"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["chosen"] is not None
        assert body["trip"]["routed"] is True
        assert body["considered"] >= 1
        assert "walk_km" in body["chosen"] and "detour_km" in body["chosen"]
        assert body["route_km"] > 20

        # 2. route-for-map is simplified and keeps endpoints
        m = await ac.get(f"/api/v1/trips/{trip_id}/route?max_points=25", headers=_h(tok))
        assert m.status_code == 200, m.text
        geom = m.json()["geometry"]["coordinates"]
        assert 2 <= len(geom) <= 25
        assert geom[0] == route["coordinates"][0]
        assert geom[-1] == route["coordinates"][-1]

        # 3. bad coordinates -> 422; unknown trip -> 404
        assert (await ac.post(f"/api/v1/trips/{trip_id}/pickup-options", headers=_h(tok),
                              json={"pickup_coordinates": [200.0, 13.0],
                                    "dropoff_coordinates": [77.67, 12.8452]})).status_code == 422
        assert (await ac.get("/api/v1/trips/64f000000000000000000000/route",
                headers=_h(tok))).status_code == 404

    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^PickupTest"}})
