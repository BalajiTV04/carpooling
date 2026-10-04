"""Module 17 tests: tracking math (pure) + ping/live/trail flow (live)."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.tracking import is_stale, progress_frac, speed_kmph


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


ROUTE = [[0.0, 0.0], [0.05, 0.0], [0.1, 0.0]]


def test_progress_midpoint_and_offroute():
    mid = progress_frac(ROUTE, 0.05, 0.0)
    assert abs(mid["frac"] - 0.5) < 0.02
    assert mid["off_route"] is False
    assert mid["remaining_km"] < mid["route_km"]
    far = progress_frac(ROUTE, 0.05, 0.05)
    assert far["off_route"] is True
    assert far["off_route_m"] > 500


def test_speed_and_stale():
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    prev = {"lng": 0.0, "lat": 0.0, "at": now - timedelta(seconds=60)}
    v = speed_kmph(prev, 0.01, 0.0, now)
    assert v is not None and 50 < v < 80
    assert speed_kmph(None, 0.0, 0.0, now) is None
    assert speed_kmph(prev, 0.01, 0.0, now - timedelta(seconds=60)) is None
    assert is_stale(now - timedelta(seconds=400), now) is True
    assert is_stale(now - timedelta(seconds=10), now) is False
    assert is_stale(None, now) is True


@pytest.mark.asyncio
async def test_ping_live_trail_flow():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax, outsider = "+919000001701", "+919000001702", "+919000001703"
    for p in (drv, pax, outsider):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^TrackTest"}})
    await db.bookings.delete_many({})
    await db.locations.delete_many({"trip_id": {"$exists": True}})

    async with _client() as ac:
        toks = {}
        for p in (drv, pax, outsider):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Track " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
            toks[p] = (await ac.post("/api/v1/auth/login",
                        json={"phone": p, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me",
               headers=_h(toks[drv]))).json()["id"]

        depart = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0)
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
            "source": {"name": "TrackTest A", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "TrackTest B", "point": {"type": "Point",
                             "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0],
                [77.65, 12.92], [77.67, 12.8452]]},
            "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        })).inserted_id)

        # 1. passenger live before any ping: shared-but-empty state
        await db.bookings.insert_one({
            "trip_id": ObjectId(trip_id),
            "passenger_id": ObjectId((await ac.get(
                "/api/v1/auth/me", headers=_h(toks[pax]))).json()["id"]),
            "driver_id": ObjectId(uid), "seats": 1, "status": "confirmed",
            "pickup": {"point": {"type": "Point",
                                 "coordinates": [77.5946, 13.0358]}},
            "dropoff": {"point": {"type": "Point",
                                  "coordinates": [77.67, 12.8452]}},
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)})
        empty = (await ac.get(f"/api/v1/tracking/live/{trip_id}",
                 headers=_h(toks[pax]))).json()
        assert empty["fix"] is None and empty["stale"] is True

        # 2. outsider blocked; passenger ping blocked; bad coords 422
        assert (await ac.get(f"/api/v1/tracking/live/{trip_id}",
                headers=_h(toks[outsider]))).status_code == 403
        assert (await ac.post("/api/v1/tracking/ping", headers=_h(toks[pax]),
                json={"trip_id": trip_id, "lng": 77.6,
                      "lat": 13.0})).status_code == 403
        assert (await ac.post("/api/v1/tracking/ping", headers=_h(toks[drv]),
                json={"trip_id": trip_id, "lng": 999,
                      "lat": 13.0})).status_code == 422

        # 3. first driver ping: stores + auto-starts published -> ongoing
        r = await ac.post("/api/v1/tracking/ping", headers=_h(toks[drv]),
                          json={"trip_id": trip_id, "lng": 77.62,
                                "lat": 13.0, "speed_kmph": 30.0})
        assert r.status_code == 200, r.text
        assert r.json()["started"] is True
        assert r.json()["trip_status"] == "ongoing"
        assert (await db.trips.find_one(
            {"_id": ObjectId(trip_id)}))["status"] == "ongoing"

        # 4. second ping mid-route: live shows progress, trail has 2 fixes
        r2 = await ac.post("/api/v1/tracking/ping", headers=_h(toks[drv]),
                           json={"trip_id": trip_id, "lng": 77.65,
                                 "lat": 12.92, "speed_kmph": 35.0})
        assert r2.json()["started"] is False
        live = (await ac.get(f"/api/v1/tracking/live/{trip_id}",
                headers=_h(toks[pax]))).json()
        assert live["fix"]["lng"] == 77.65
        assert live["fix"]["speed_kmph"] == 35.0
        assert 0.0 < live["progress"]["frac"] <= 1.0
        assert live["progress"]["off_route"] is False
        assert live["stale"] is False
        trail = (await ac.get(f"/api/v1/tracking/trail/{trip_id}",
                 headers=_h(toks[pax]))).json()
        assert trail["count"] == 2
        assert trail["fixes"][0]["lng"] == 77.65

    for p in (drv, pax, outsider):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^TrackTest"}})
    await db.bookings.delete_many({})
