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


# ---------------------------------------------------------------------------
# Phase 3 Tests: Module 10 Minimum-Detour Pickup Optimization
# ---------------------------------------------------------------------------
import json
import os
from app.services.cost import compute_detour_contribution
from app.services.matching import match_fallback, match_trip
from app.services.pickup import densify_route, project_point

DEV = [77.7120, 13.2437]  # Devanahalli
YEL = [77.5963, 13.1007]  # Yelahanka
HEB = [77.5970, 13.0358]  # Hebbal

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "devanahalli_hebbal.json")


def _load_dev_heb_fixture():
    if os.path.exists(FIXTURE_PATH):
        with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    # Synthetic fallback if fixture missing
    return {
        "geometry": {"coordinates": [DEV, YEL, HEB]},
        "distance_km": 28.59,
        "duration_min": 28.5,
    }


def test_1_devanahalli_hebbal_example_trip():
    """1. Driver Devanahalli->Hebbal, Passenger Yelahanka->Hebbal."""
    fix = _load_dev_heb_fixture()
    coords = fix["geometry"]["coordinates"]
    driver_dist = fix["distance_km"]

    res = match_trip(coords, YEL, HEB, max_pickup_km=3.0, max_detour_km=3.0)
    assert res["feasible"] is True, res.get("reason")
    assert res["detour_km"] <= 0.5
    # passenger distance between 25% and 60% of driver's full distance
    pax_dist = res["passenger_distance_km"]
    assert 0.20 * driver_dist <= pax_dist <= 0.60 * driver_dist

    # Cost lower than full-trip cost
    full_cost = compute_detour_contribution(
        passenger_distance_km=driver_dist,
        detour_km=0.0,
        mileage_kmpl=15.0,
        fuel_price_per_litre=100.0,
        occupants=2,
    )["estimated_contribution"]

    pax_cost = compute_detour_contribution(
        passenger_distance_km=pax_dist,
        detour_km=res["detour_km"],
        mileage_kmpl=15.0,
        fuel_price_per_litre=100.0,
        occupants=2,
    )["estimated_contribution"]

    assert pax_cost < full_cost


def test_2_destination_tolerance():
    """2. Destination 1-1.5 km from Hebbal: included. 8 km away: excluded."""
    fix = _load_dev_heb_fixture()
    coords = fix["geometry"]["coordinates"]

    # Destination ~1 km north of Hebbal (~0.009 deg lat)
    near_dst = [HEB[0], HEB[1] + 0.009]
    res_near = match_trip(coords, YEL, near_dst, dest_tolerance_km=2.0)
    assert res_near["feasible"] is True, res_near.get("reason")

    # Destination 8 km away (~0.072 deg lng)
    far_dst = [HEB[0] + 0.072, HEB[1]]
    res_far = match_trip(coords, YEL, far_dst, dest_tolerance_km=2.0)
    assert res_far["feasible"] is False
    assert "destination too far" in res_far["reason"]


def test_3_opposite_direction():
    """3. Passenger Hebbal->Yelahanka (opposite direction): excluded."""
    fix = _load_dev_heb_fixture()
    coords = fix["geometry"]["coordinates"]

    res = match_trip(coords, HEB, YEL)
    assert res["feasible"] is False
    assert "wrong direction" in res["reason"]


def test_4_source_behind_driver_start():
    """4. Source far behind driver's start beyond MAX_PICKUP_KM: excluded."""
    fix = _load_dev_heb_fixture()
    coords = fix["geometry"]["coordinates"]

    behind = [DEV[0] + 0.1, DEV[1] + 0.1]
    res = match_trip(coords, behind, HEB, max_pickup_km=3.0)
    assert res["feasible"] is False
    assert "pickup too far" in res["reason"]


def test_5_source_off_route_detour():
    """5. Source 1 km off route: included with detour > 0; 8 km off route: excluded."""
    fix = _load_dev_heb_fixture()
    coords = fix["geometry"]["coordinates"]

    # 1 km east of Yelahanka (offset ~ 1.0 km)
    off_1km = [YEL[0] + 0.009, YEL[1]]
    res_1km = match_trip(coords, off_1km, HEB, max_pickup_km=3.0, max_detour_km=3.0)
    assert res_1km["feasible"] is True, res_1km.get("reason")
    assert res_1km["detour_km"] > 0.0

    # 8 km east of Yelahanka
    off_8km = [YEL[0] + 0.08, YEL[1]]
    res_8km = match_trip(coords, off_8km, HEB, max_pickup_km=3.0)
    assert res_8km["feasible"] is False
    assert "pickup too far" in res_8km["reason"]


def test_6_short_passenger_leg_inside_long_trip():
    """6. A 3 km passenger leg inside a 30 km driver trip is NOT excluded by overlap gate."""
    # Synthetic ~33 km straight route
    synth_30km = [[0.0, 0.0], [0.15, 0.0], [0.30, 0.0]]
    pax_src = [0.10, 0.0]
    pax_dst = [0.127, 0.0]  # ~3 km leg

    res = match_trip(synth_30km, pax_src, pax_dst, min_overlap_pct=20.0)
    assert res["feasible"] is True, res.get("reason")
    assert res["passenger_overlap_pct"] >= 20.0


def test_7_straight_line_fallback_geometry():
    """7. Straight-line fallback geometry: matched with route_quality='straight_line'."""
    res = match_fallback([0.0, 0.0], [0.1, 0.0], [0.02, 0.0], [0.08, 0.0])
    assert res["feasible"] is True
    assert res["route_quality"] == "straight_line"
    assert res["routed"] is False


def test_8_projection_units_and_scaling():
    """8. Segment projection (not vertex), end clamping, latitude cos scaling."""
    route = [[0.0, 13.0], [0.1, 13.0]]
    # Point off middle of segment
    p = project_point(route, [0.05, 13.001])
    assert p["seg_index"] == 0
    assert 0.45 <= p["t"] <= 0.55
    assert p["offset_km"] < 0.2

    # Clamping before start
    before = project_point(route, [-0.05, 13.0])
    assert before["along_km"] == 0.0
    assert before["t"] == 0.0

    # Clamping after end
    after = project_point(route, [0.15, 13.0])
    assert after["t"] == 1.0


def test_9_cost_depends_on_passenger_distance_not_driver_distance():
    """9. Cost depends on passenger distance, not on driver trip length."""
    # 12 km @ 20 kmpl @ Rs 100/l with 2 occupants -> Rs 30
    c12 = compute_detour_contribution(
        passenger_distance_km=12.0,
        detour_km=0.0,
        mileage_kmpl=20.0,
        fuel_price_per_litre=100.0,
        occupants=2,
    )
    assert c12["estimated_contribution"] == 30.0
    assert c12["label"] == "Estimated Travel Contribution"

    # Driver full 30 km trip cost with 2 occupants would be 75.0
    c30 = compute_detour_contribution(
        passenger_distance_km=30.0,
        detour_km=0.0,
        mileage_kmpl=20.0,
        fuel_price_per_litre=100.0,
        occupants=2,
    )
    assert c30["estimated_contribution"] == 75.0
    assert c12["estimated_contribution"] < c30["estimated_contribution"]

