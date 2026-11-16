"""Minimum-detour pickup optimisation tests (Module: detour).

Pure geometry tests run without Mongo/OSRM by calling ``evaluate_detour``
directly and monkeypatching ``app.services.detour.osrm_route``.
Endpoint test skips cleanly when Mongo is down.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import pytest
from httpx import AsyncClient, ASGITransport
from bson import ObjectId

from app.main import app
from app.services.detour import (
    DetourConfig,
    DetourResult,
    evaluate_detour,
)
from app.services.geo_math import haversine_km, route_length_km
import app.services.detour as detour_module


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# Sample coordinates (lng, lat) per spec — used ONLY in tests as samples.
DEV = [77.7120, 13.2437]  # Devanahalli
YEL = [77.5963, 13.1007]  # Yelahanka
HEB = [77.5970, 13.0358]  # Hebbal


def _km(a: List[float], b: List[float]) -> float:
    return haversine_km(a, b)


def make_trip(
    route: List[List[float]],
    depart_at: datetime,
    seats_offered: int = 3,
    seats_booked: int = 0,
    distance_km: Optional[float] = None,
) -> Dict:
    return {
        "driver_id": None,
        "vehicle_id": None,
        "source": {"name": "A", "point": {"type": "Point", "coordinates": route[0]}},
        "destination": {
            "name": "C",
            "point": {"type": "Point", "coordinates": route[-1]},
        },
        "route_geometry": {"type": "LineString", "coordinates": route},
        "distance_km": distance_km if distance_km is not None
        else round(route_length_km(route), 2),
        "duration_min": 60.0,
        "depart_at": depart_at,
        "seats_offered": seats_offered,
        "seats_booked": seats_booked,
        "status": "published",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


def future_tomorrow(hour: int = 9) -> datetime:
    t = datetime.now(timezone.utc) + timedelta(days=1)
    return t.replace(hour=hour, minute=0, second=0, microsecond=0)
def _run(doc, src, dst, seats=1, wanted_dt=None):
    import asyncio

    return asyncio.get_event_loop().run_until_complete(
        evaluate_detour(doc, src, dst, seats_needed=seats, wanted_dt=wanted_dt)
    )


@pytest.mark.asyncio
async def test_on_route_detour_zero():
    """Devanahalli->Hebbal trip via Yelahanka; passenger Yelahanka->Hebbal."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    res = await evaluate_detour(doc, YEL, HEB, seats_needed=1)
    assert res.feasible is True, res.reason
    assert res.pickup.on_route is True
    assert res.detour_km == 0.0
    # passenger distance (YEL->HEB) is less than the driver's full trip.
    assert 0 < res.passenger_distance_km < res.route_total_km
    # overlap is the share of the route the passenger rides.
    assert res.route_overlap_percent > 0


@pytest.mark.asyncio
async def test_destination_near_shown():
    """Passenger destination 1 km from Hebbal (within DEST_TOLERANCE_KM=2)."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    # 1 km north of Hebbal (~0.009 deg lat).
    near_heb = [HEB[0], HEB[1] + 0.009]
    res = await evaluate_detour(doc, YEL, near_heb, seats_needed=1)
    assert res.feasible is True, res.reason


@pytest.mark.asyncio
async def test_destination_far_rejected():
    """Passenger destination 8 km from Hebbal is rejected."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    # 8 km east of Yelahanka -> nearest route point is mid-route, far from C.
    far = [YEL[0] + 0.072, YEL[1]]
    res = await evaluate_detour(doc, YEL, far, seats_needed=1)
    assert res.feasible is False, f"expected rejection, got {res}"


@pytest.mark.asyncio
async def test_opposite_direction_rejected():
    """Passenger Hebbal->Yelahanka against Devanahalli->Hebbal trip."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    res = await evaluate_detour(doc, HEB, YEL, seats_needed=1)
    assert res.feasible is False, res.reason
@pytest.mark.asyncio
async def test_off_route_detour_six_km_rejected():
    """Off-route source needing a 6 km detour -> rejected (MAX_DETOUR_KM=3)."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    off = [YEL[0] + 0.009, YEL[1]]  # ~1 km east of Yelahanka (off route)
    _OSRM_RETURN["distance_km"] = 6.0
    res = await evaluate_detour(doc, off, HEB, seats_needed=1)
    assert res.feasible is False, f"expected rejection, got {res}"


@pytest.mark.asyncio
async def test_off_route_detour_one_point_five_km_shown():
    """Off-route source needing a 1.5 km detour -> shown with detour_km."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    off = [YEL[0] + 0.009, YEL[1]]
    _OSRM_RETURN["distance_km"] = 1.5
    res = await evaluate_detour(doc, off, HEB, seats_needed=1)
    assert res.feasible is True, res.reason
    assert abs(res.detour_km - 1.5) < 0.01


@pytest.mark.asyncio
async def test_no_seats_not_shown():
    """seats_available = 0 -> not shown."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9), seats_offered=2, seats_booked=2)
    res = await evaluate_detour(doc, YEL, HEB, seats_needed=1)
    assert res.feasible is False
    assert res.reason == "no seats available"


@pytest.mark.asyncio
async def test_routing_api_failure_falls_back_estimated_true():
    """OSRM returns None -> haversine fallback, estimated=True."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    off = [YEL[0] + 0.009, YEL[1]]
from app.services.cost import compute_detour_contribution


def test_cost_formula_matches_example():
    """12 km @ 20 kmpl @ Rs 100/l -> fuel_cost Rs 60; 2 occupants -> Rs 30."""
    out = compute_detour_contribution(
        passenger_distance_km=12.0,
        detour_km=0.0,
        mileage_kmpl=20.0,
        fuel_price_per_litre=100.0,
        occupants=2,
        policy="EQUAL_SPLIT",
        include_detour_cost=False,
    )
    assert out["label"] == "Estimated Travel Contribution"
    assert out["fuel_litres"] == 0.6
    assert out["fuel_cost"] == 60.0
    assert out["estimated_contribution"] == 30.0


def test_cost_changes_with_mileage_and_price():
    base = compute_detour_contribution(
        passenger_distance_km=12.0, detour_km=0.0, mileage_kmpl=20.0,
        fuel_price_per_litre=100.0, occupants=2)
    worse_mileage = compute_detour_contribution(
        passenger_distance_km=12.0, detour_km=0.0, mileage_kmpl=10.0,
        fuel_price_per_litre=100.0, occupants=2)
    higher_price = compute_detour_contribution(
        passenger_distance_km=12.0, detour_km=0.0, mileage_kmpl=20.0,
        fuel_price_per_litre=200.0, occupants=2)
    assert worse_mileage["estimated_contribution"] > base["estimated_contribution"]
    assert higher_price["estimated_contribution"] > base["estimated_contribution"]


def test_full_passenger_share_policy():
    out = compute_detour_contribution(
        passenger_distance_km=12.0, detour_km=0.0, mileage_kmpl=20.0,
        fuel_price_per_litre=100.0, occupants=2, policy="FULL_PASSENGER_SHARE")
    assert out["estimated_contribution"] == 60.0  # whole fuel cost


def test_include_detour_cost_adds_detour_fuel():
    base = compute_detour_contribution(
        passenger_distance_km=12.0, detour_km=0.0, mileage_kmpl=20.0,
        fuel_price_per_litre=100.0, occupants=2, include_detour_cost=False)
    with_detour = compute_detour_contribution(
        passenger_distance_km=12.0, detour_km=3.0, mileage_kmpl=20.0,
        fuel_price_per_litre=100.0, occupants=2, include_detour_cost=True)
    assert with_detour["fuel_cost"] > base["fuel_cost"]


@pytest.mark.asyncio
async def test_twenty_candidates_response_time_reasonable():
    """20 candidate trips evaluated quickly (no real OSRM calls)."""
    import time
    route = [DEV, YEL, HEB]
    docs = [make_trip(route, future_tomorrow(9)) for _ in range(20)]
    _OSRM_RETURN["distance_km"] = None
    start = time.perf_counter()
    results = []
    for d in docs:
        r = await evaluate_detour(d, YEL, HEB, seats_needed=1)
        results.append(r)
    elapsed = time.perf_counter() - start
    feasible = [r for r in results if r.feasible]
    assert len(results) == 20
    assert elapsed < 5.0, f"too slow: {elapsed:.2f}s for 20 trips"
    # every result carries a boolean estimated flag (never silently invented)
    assert all(isinstance(r.estimated, bool) for r in results)


@pytest.mark.asyncio
async def test_search_with_detour_endpoint(monkeypatch):
    """Live endpoint: skips if Mongo down; otherwise returns shaped results."""
    from app.core.database import get_db, ping_db
    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    phone = "+919000009901"
    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^DetourTest"}})

    async with _client() as ac:
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234",
            "full_name": "Detour Driver", "roles": ["driver", "passenger"]})).status_code == 201
        tok = (await ac.post("/api/v1/auth/login",
                             json={"phone": phone, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me",
                            headers={"Authorization": "Bearer " + tok})).json()["id"]

        now = future_tomorrow(9)
        route = [DEV, YEL, HEB]
        trip_id = (await db.trips.insert_one({
            "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
            "source": {"name": "DetourTest Dev", "point": {"type": "Point", "coordinates": DEV}},
            "destination": {"name": "DetourTest Heb", "point": {"type": "Point", "coordinates": HEB}},
            "route_geometry": {"type": "LineString", "coordinates": route},
            "distance_km": 30.0, "duration_min": 50.0, "depart_at": now,
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc),
        })).inserted_id

        r = await ac.post("/api/v1/rides/search-with-detour", json={
            "source": {"lat": YEL[1], "lng": YEL[0], "address": "Yelahanka"},
            "destination": {"lat": HEB[1], "lng": HEB[0], "address": "Hebbal"},
            "date": now.strftime("%Y-%m-%d"), "time": "09:00", "seats": 1},
            headers={"Authorization": "Bearer " + tok})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] >= 1
        hit = body["results"][0]
        for key in ("trip_id", "driver_name", "vehicle", "seats_available",
                    "departure_time", "pickup_point", "drop_point",
                    "walk_distance_km", "detour_km", "extra_time_min",
                    "passenger_distance_km", "estimated_contribution",
                    "estimated", "route_overlap_percent",
                    "driver_route_polyline", "passenger_segment_polyline"):
            assert key in hit, f"missing {key}"
        assert hit["detour_km"] == 0.0

    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"_id": trip_id})
    await db.trips.delete_many({"source.name": {"$regex": "^DetourTest"}})


@pytest.mark.asyncio
async def test_pickup_behind_start_rejected():
    """Pickup 4 km before driver origin -> outside max pickup distance."""
    route = [DEV, YEL, HEB]
    doc = make_trip(route, future_tomorrow(9))
    # 4 km before Devanahalli (further north-east).
    behind = [DEV[0] + 0.036, DEV[1] + 0.036]
    res = await evaluate_detour(doc, behind, HEB, seats_needed=1)
    assert res.feasible is False, res.reason



# Monkeypatch target for OSRM: (distance_km or None) to simulate success/failure.
_OSRM_RETURN: Dict = {"distance_km": None}


async def _fake_osrm(src: List[float], dst: List[float]):
    if _OSRM_RETURN["distance_km"] is None:
        return None
    return {"geometry": {"type": "LineString", "coordinates": [src, dst]},
            "distance_km": _OSRM_RETURN["distance_km"],
            "duration_min": 10.0}


@pytest.fixture(autouse=True)
def _patch_osrm(monkeypatch):
    monkeypatch.setattr(detour_module, "osrm_route", _fake_osrm)
    _OSRM_RETURN["distance_km"] = None
    yield

