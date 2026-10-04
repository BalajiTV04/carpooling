"""Module 11 tests: booking flow with atomic seats + snapshots.
Needs live Mongo. Seeded trip avoids repeating Module 6's gate dance.
Run: pytest -q."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}

@pytest.mark.asyncio
async def test_booking_flow():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax1, pax2 = "+919000001101", "+919000001102", "+919000001103"
    for p in (drv, pax1, pax2):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^BookingTest"}})
    await db.bookings.delete_many({})

    async with _client() as ac:
        for p, name in ((drv, "B Driver"), (pax1, "B Pax One"), (pax2, "B Pax Two")):
            r = await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": name, "roles": ["driver", "passenger"]})
            assert r.status_code == 201, r.text
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t1 = (await ac.post("/api/v1/auth/login",
              json={"phone": pax1, "password": "pass1234"})).json()["access_token"]
        t2 = (await ac.post("/api/v1/auth/login",
              json={"phone": pax2, "password": "pass1234"})).json()["access_token"]
        uid_drv = (await ac.get("/api/v1/auth/me", headers=_h(t_drv))).json()["id"]

        # driver + pax2 verify immediately; pax1 stays unverified for step 1
        for phone in (drv, pax2):
            otpx = (await ac.post("/api/v1/auth/otp/request",
                    json={"phone": phone})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": phone, "code": otpx["dev_code"]})

        now = datetime.now(timezone.utc)
        route = {"type": "LineString", "coordinates": [
            [77.5946, 13.0358], [77.62, 13.0], [77.65, 12.92], [77.67, 12.8452]]}
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid_drv), "vehicle_id": ObjectId(),
            "source": {"name": "BookingTest A", "point": {"type": "Point",
                       "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "BookingTest B", "point": {"type": "Point",
                            "coordinates": [77.67, 12.8452]}},
            "route_geometry": route, "distance_km": 30.0, "duration_min": 50.0,
            "depart_at": now + timedelta(days=5), "seats_offered": 2,
            "seats_booked": 0, "status": "published",
            "created_at": now, "updated_at": now,
        })).inserted_id)

        body = {"trip_id": trip_id, "seats": 1,
                "pickup_coordinates": [77.60, 13.01],
                "dropoff_coordinates": [77.665, 12.87]}

        # 1. unverified passenger -> 403; then verify pax1 via dev OTP
        r = await ac.post("/api/v1/bookings", json=body, headers=_h(t1))
        assert r.status_code == 403
        otp = (await ac.post("/api/v1/auth/otp/request", json={"phone": pax1})).json()
        assert (await ac.post("/api/v1/auth/otp/verify",
                json={"phone": pax1, "code": otp["dev_code"]})).status_code == 200

        # 2. driver cannot book own trip
        assert (await ac.post("/api/v1/bookings", json=body,
                headers=_h(t_drv))).status_code == 422

        # 3. create -> 201, seats reserved, snapshots (pickup snapped + overlap)
        r = await ac.post("/api/v1/bookings", json=body, headers=_h(t1))
        assert r.status_code == 201, r.text
        bk = r.json()
        assert bk["status"] == "requested"
        assert bk["overlap_pct"] is not None and bk["overlap_pct"] > 50
        assert bk["pickup"]["point"]["coordinates"] != body["pickup_coordinates"]
        bid = bk["id"]
        trip_doc = await db.trips.find_one({"_id": ObjectId(trip_id)})
        assert trip_doc["seats_booked"] == 1

        # 4. duplicate active booking -> 409
        assert (await ac.post("/api/v1/bookings", json=body,
                headers=_h(t1))).status_code == 409

        # 5. transitions: pax cannot accept (403); confirm before accept (422)
        assert (await ac.post(f"/api/v1/bookings/{bid}/accept",
                headers=_h(t1))).status_code == 403
        assert (await ac.post(f"/api/v1/bookings/{bid}/confirm",
                headers=_h(t1))).status_code == 422

        # 6. accept -> confirm; seat counter unchanged (reserved at request)
        r = await ac.post(f"/api/v1/bookings/{bid}/accept", headers=_h(t_drv))
        assert r.status_code == 200 and r.json()["status"] == "accepted"
        r = await ac.post(f"/api/v1/bookings/{bid}/confirm", headers=_h(t1))
        assert r.status_code == 200 and r.json()["status"] == "confirmed"
        trip_doc = await db.trips.find_one({"_id": ObjectId(trip_id)})
        assert trip_doc["seats_booked"] == 1

        # 7. pax2 books last seat; a third request -> 409 (none left)
        otp2 = (await ac.post("/api/v1/auth/otp/request", json={"phone": pax2})).json()
        await ac.post("/api/v1/auth/otp/verify",
                      json={"phone": pax2, "code": otp2["dev_code"]})
        r = await ac.post("/api/v1/bookings", json=dict(body, seats=1), headers=_h(t2))
        assert r.status_code == 201, r.text
        bid2 = r.json()["id"]
        await ac.post("/api/v1/auth/register", json={
            "phone": "+919000001104", "password": "pass1234",
            "full_name": "B Pax Three", "roles": ["passenger"]})
        t3 = (await ac.post("/api/v1/auth/login",
              json={"phone": "+919000001104", "password": "pass1234"})).json()["access_token"]
        otp3 = (await ac.post("/api/v1/auth/otp/request",
                json={"phone": "+919000001104"})).json()
        await ac.post("/api/v1/auth/otp/verify",
                      json={"phone": "+919000001104", "code": otp3["dev_code"]})
        assert (await ac.post("/api/v1/bookings", json=body,
                headers=_h(t3))).status_code == 409

        # 8. driver rejects pax2 -> seat released (1 left again)
        r = await ac.post(f"/api/v1/bookings/{bid2}/reject", headers=_h(t_drv))
        assert r.status_code == 200 and r.json()["status"] == "rejected"
        trip_doc = await db.trips.find_one({"_id": ObjectId(trip_id)})
        assert trip_doc["seats_booked"] == 1

        # 9. views: driver incoming + passenger mine both show the booking
        inc = await ac.get("/api/v1/bookings/incoming", headers=_h(t_drv))
        assert any(b["id"] == bid for b in inc.json())
        mine = await ac.get("/api/v1/bookings/mine", headers=_h(t1))
        assert any(b["id"] == bid for b in mine.json())

        # 10. passenger cancels -> seat released; cancel again -> 422
        r = await ac.post(f"/api/v1/bookings/{bid}/cancel", headers=_h(t1))
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        trip_doc = await db.trips.find_one({"_id": ObjectId(trip_id)})
        assert trip_doc["seats_booked"] == 0
        assert (await ac.post(f"/api/v1/bookings/{bid}/cancel",
                headers=_h(t1))).status_code == 422

    for p in (drv, pax1, pax2, "+919000001104"):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^BookingTest"}})
    await db.bookings.delete_many({})