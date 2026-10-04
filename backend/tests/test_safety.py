"""Module 18 tests: safety verdicts (pure) + SOS/auto/ack flow (live)."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.safety import deviation_verdict, speed_verdict


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def test_speed_verdict_ladder():
    assert speed_verdict(None)["over"] is False
    assert speed_verdict(70.0)["over"] is False
    assert speed_verdict(80.0)["over"] is False
    assert speed_verdict(90.0) == {"over": True, "severity": "medium", "margin": 10.0}
    assert speed_verdict(105.0)["severity"] == "high"
    assert speed_verdict(130.0)["severity"] == "critical"



@pytest.mark.asyncio
async def test_sos_auto_ack_flow():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax = "+919000001801", "+919000001802"
    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^SafeTest"}})
    await db.bookings.delete_many({})
    await db.safety_alerts.delete_many({})

    async with _client() as ac:
        for p in (drv, pax):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Safe " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t_pax = (await ac.post("/api/v1/auth/login",
                 json={"phone": pax, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me",
               headers=_h(t_drv))).json()["id"]
        pax_id = (await ac.get("/api/v1/auth/me",
                  headers=_h(t_pax))).json()["id"]

        depart = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0)
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
            "source": {"name": "SafeTest A", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "SafeTest B", "point": {"type": "Point",
                             "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0],
                [77.65, 12.92], [77.67, 12.8452]]},
            "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        })).inserted_id)
        await db.bookings.insert_one({
            "trip_id": ObjectId(trip_id), "passenger_id": ObjectId(pax_id),
            "driver_id": ObjectId(uid), "seats": 1, "status": "confirmed",
            "pickup": {"point": {"type": "Point",
                                 "coordinates": [77.5946, 13.0358]}},
            "dropoff": {"point": {"type": "Point",
                                  "coordinates": [77.67, 12.8452]}},
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)})

        # 1. speeding ping: auto speed alert (medium), returned inline
        r = await ac.post("/api/v1/tracking/ping", headers=_h(t_drv),
                          json={"trip_id": trip_id, "lng": 77.62,
                                "lat": 13.0, "speed_kmph": 95.0})
        assert r.status_code == 200, r.text
        assert len(r.json()["alerts"]) == 1
        assert r.json()["alerts"][0]["type"] == "speed"
        assert r.json()["alerts"][0]["severity"] == "medium"

        # 2. repeat speeding ping ON the route: deduped (no second speed alert)
        r2 = await ac.post("/api/v1/tracking/ping", headers=_h(t_drv),
                           json={"trip_id": trip_id, "lng": 77.62,
                                 "lat": 13.0, "speed_kmph": 96.0})
        assert r2.json()["alerts"] == []
        assert await db.safety_alerts.count_documents(
            {"trip_id": ObjectId(trip_id), "type": "speed",
             "status": "open"}) == 1

        # 3. off-route ping: auto deviation alert (high) alongside
        r3 = await ac.post("/api/v1/tracking/ping", headers=_h(t_drv),
                           json={"trip_id": trip_id, "lng": 77.0,
                                 "lat": 13.5, "speed_kmph": 40.0})
        types = {a["type"] for a in r3.json()["alerts"]}
        assert types == {"deviation"}

        # 4. passenger SOS: critical, never deduped (two presses = two rows)
        s1 = await ac.post("/api/v1/safety/sos", headers=_h(t_pax),
                           json={"trip_id": trip_id, "message": "help"})
        assert s1.status_code == 200, s1.text
        assert s1.json()["severity"] == "critical"
        s2 = await ac.post("/api/v1/safety/sos", headers=_h(t_pax),
                           json={"trip_id": trip_id, "message": "help again"})
        assert s2.status_code == 200
        assert s1.json()["id"] != s2.json()["id"]

        # 5. feed: open count 4 (speed + deviation + 2 sos), open first
        feed = (await ac.get(f"/api/v1/safety/trip/{trip_id}",
                headers=_h(t_pax))).json()
        assert feed["open"] == 4
        assert feed["alerts"][0]["status"] == "open"

        # 6. ack: driver ok, passenger 403, double-ack 422
        sos_id = s1.json()["id"]
        assert (await ac.post(f"/api/v1/safety/{sos_id}/ack",
                headers=_h(t_pax))).status_code == 403
        a = await ac.post(f"/api/v1/safety/{sos_id}/ack", headers=_h(t_drv))
        assert a.status_code == 200 and a.json()["status"] == "acknowledged"
        assert (await ac.post(f"/api/v1/safety/{sos_id}/ack",
                headers=_h(t_drv))).status_code == 422

    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^SafeTest"}})
    await db.bookings.delete_many({})
    await db.safety_alerts.delete_many({})


def test_deviation_verdict():
    assert deviation_verdict(None)["deviated"] is False
    assert deviation_verdict(100.0)["deviated"] is False
    assert deviation_verdict(500.0)["deviated"] is False
    assert deviation_verdict(501.0) == {"deviated": True, "severity": "high"}
