"""Module 6 tests: publish gates, lifecycle, seat-cap, visibility.
Needs live Mongo. Run: pytest -q."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


# Place names carry a "TripTest" prefix so this module's cleanup is scoped.
# An unscoped `db.trips.delete_many({})` would wipe a developer's demo data —
# see tests/conftest.py, which additionally gives the suite its own database.
SRC = {"name": "TripTest Hebbal, Bengaluru", "coordinates": [77.5946, 13.0358]}
DST = {"name": "TripTest Electronic City, Bengaluru", "coordinates": [77.67, 12.8452]}
NEAR = {"name": "TripTest Same spot", "coordinates": [77.5947, 13.0359]}



@pytest.mark.asyncio
async def test_trip_flow():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax = "+919000000601", "+919000000602"
    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.vehicles.delete_many({"plate_no": "KA06TRIP01"})
    # Namespaced, never delete_many({}): the suite must not be able to
    # wipe a whole collection out from under demo data. See conftest.py.
    await db.trips.delete_many({"source.name": {"$regex": "^TripTest"}})

    async with _client() as ac:
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": drv, "password": "pass1234",
            "full_name": "Trip Driver", "roles": ["driver"]})).status_code == 201
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": pax, "password": "pass1234",
            "full_name": "Trip Pax", "roles": ["passenger"]})).status_code == 201
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t_pax = (await ac.post("/api/v1/auth/login",
                 json={"phone": pax, "password": "pass1234"})).json()["access_token"]
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        # 1. unverified phone cannot stage trips -> 403
        car = await ac.post("/api/v1/vehicles", json={
            "make": "Honda", "model": "City", "plate_no": "KA06TRIP01",
            "seats_total": 3, "fuel_type": "petrol"}, headers=_h(t_drv))
        assert car.status_code == 201
        vid = car.json()["id"]
        base = {"vehicle_id": vid, "source": SRC, "destination": DST, "seats_offered": 2}
        assert (await ac.post("/api/v1/trips", json=dict(base, depart_at=future),
                headers=_h(t_drv))).status_code == 403

        # verify phone, then admin-verify vehicle (temp admin promotion)
        otp = (await ac.post("/api/v1/auth/otp/request",
                             json={"phone": drv})).json()
        assert (await ac.post("/api/v1/auth/otp/verify", json={
            "phone": drv, "code": otp["dev_code"]})).status_code == 200
        await db.users.update_one({"phone": drv}, {"$set": {"roles": ["admin"]}})
        t_adm = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        assert (await ac.post("/api/v1/vehicles/admin/" + vid + "/verify?decision=verified",
                              headers=_h(t_adm))).status_code == 200
        await db.users.update_one({"phone": drv}, {"$set": {"roles": ["driver"]}})
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]

        # 2. past depart / too-close / over-capacity -> 422
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert (await ac.post("/api/v1/trips", json=dict(base, depart_at=past),
                headers=_h(t_drv))).status_code == 422
        assert (await ac.post("/api/v1/trips", json=dict(base, depart_at=future,
                destination=NEAR), headers=_h(t_drv))).status_code == 422
        assert (await ac.post("/api/v1/trips", json=dict(base, depart_at=future,
                seats_offered=5), headers=_h(t_drv))).status_code == 422

        # 3. create draft -> seats_left == offered, crow-flies distance set
        c = await ac.post("/api/v1/trips", json=dict(base, depart_at=future),
                          headers=_h(t_drv))
        assert c.status_code == 201, c.text
        tid = c.json()["id"]
        assert c.json()["status"] == "draft"
        assert c.json()["seats_left"] == 2
        assert c.json()["distance_km"] and c.json()["distance_km"] > 20

        # 4. passenger blocked from create (403) but can view (200)
        assert (await ac.post("/api/v1/trips", json=dict(base, depart_at=future),
                headers=_h(t_pax))).status_code == 403
        assert (await ac.get("/api/v1/trips/" + tid,
                headers=_h(t_pax))).status_code == 200

        # 5. publish -> published; double publish -> 422
        assert (await ac.post("/api/v1/trips/" + tid + "/publish",
                headers=_h(t_drv))).json()["status"] == "published"
        assert (await ac.post("/api/v1/trips/" + tid + "/publish",
                headers=_h(t_drv))).status_code == 422

        # 6. lowering seats below booked rejected; raising ok
        await db.trips.update_one({"_id": ObjectId(tid)}, {"$set": {"seats_booked": 2}})
        assert (await ac.patch("/api/v1/trips/" + tid, json={"seats_offered": 1},
                headers=_h(t_drv))).status_code == 422
        assert (await ac.patch("/api/v1/trips/" + tid, json={"seats_offered": 3},
                headers=_h(t_drv))).status_code == 200

        # 7. cancel -> cancelled; edit after cancel -> 422; delete ok
        assert (await ac.post("/api/v1/trips/" + tid + "/cancel",
                headers=_h(t_drv))).json()["status"] == "cancelled"
        assert (await ac.patch("/api/v1/trips/" + tid, json={"seats_offered": 2},
                headers=_h(t_drv))).status_code == 422
        assert (await ac.delete("/api/v1/trips/" + tid,
                headers=_h(t_drv))).status_code == 200

    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.vehicles.delete_many({"plate_no": "KA06TRIP01"})
    # Namespaced, never delete_many({}): the suite must not be able to
    # wipe a whole collection out from under demo data. See conftest.py.
    await db.trips.delete_many({"source.name": {"$regex": "^TripTest"}})
