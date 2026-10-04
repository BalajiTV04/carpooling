"""Module 19 tests: completion rules (pure) + start/complete/receipt (live)."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.lifecycle import (
    completion_guard,
    resolve_completion,
    summarise,
)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def test_completion_guard_states():
    assert completion_guard("published")["allowed"] is True
    assert completion_guard("ongoing")["allowed"] is True
    for bad in ("draft", "cancelled"):
        g = completion_guard(bad)
        assert g["allowed"] is False and "published/ongoing" in g["reason"]
    g = completion_guard("completed")
    assert g["allowed"] is False and "already" in g["reason"]


def test_resolve_completion_mapping():
    from bson import ObjectId
    docs = [{"_id": ObjectId(), "status": "requested", "seats": 1},
            {"_id": ObjectId(), "status": "accepted", "seats": 2},
            {"_id": ObjectId(), "status": "confirmed", "seats": 1},
            {"_id": ObjectId(), "status": "rejected", "seats": 1},
            {"_id": ObjectId(), "status": "cancelled", "seats": 1}]
    plan = resolve_completion(docs)
    # 3 open bookings move; the 2 terminal ones stay put
    assert plan["counts"] == {"completed": 2, "rejected": 1}
    assert plan["unchanged"] == 2
    auto = [t for t in plan["transitions"] if t["to"] == "rejected"][0]
    assert auto["from"] == "requested" and auto["note"] == "trip completed"
    assert all(t["from"] not in ("rejected", "cancelled")
               for t in plan["transitions"])


def test_summarise_receipt_math():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId
    depart = datetime(2030, 6, 1, 9, 0, tzinfo=timezone.utc)
    trip = {"_id": ObjectId(), "status": "completed",
            "source": {"name": "A"}, "destination": {"name": "B"},
            "distance_km": 30.0, "seats_offered": 4, "depart_at": depart,
            "completed_at": depart + timedelta(minutes=45)}
    bookings = [
        {"_id": ObjectId(), "status": "completed", "seats": 2,
         "cost_share": 33.33, "created_at": depart},
        {"_id": ObjectId(), "status": "completed", "seats": 1,
         "cost_share": 16.67, "created_at": depart},
        {"_id": ObjectId(), "status": "rejected", "seats": 1,
         "cost_share": None, "created_at": depart},
    ]
    r = summarise(trip, bookings)
    assert r["seats_sold"] == 3 and r["passengers"] == 2
    assert r["collected_total"] == 50.0
    assert r["occupancy_pct"] == 75.0
    assert r["duration_min"] == 45.0
    assert r["auto_rejected"] == 0  # nothing was open in this snapshot
    assert r["completed_at"] is not None


@pytest.mark.asyncio
async def test_start_complete_receipt_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax, other = "+919000001901", "+919000001902", "+919000001903"
    for p in (drv, pax, other):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^DoneTest"}})
    await db.bookings.delete_many({})

    async with _client() as ac:
        toks = {}
        for p in (drv, pax, other):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Done " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
            toks[p] = (await ac.post("/api/v1/auth/login",
                        json={"phone": p, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me",
               headers=_h(toks[drv]))).json()["id"]
        pax_id = (await ac.get("/api/v1/auth/me",
                  headers=_h(toks[pax]))).json()["id"]

        depart = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0)
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
            "source": {"name": "DoneTest A", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "DoneTest B", "point": {"type": "Point",
                             "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0],
                [77.65, 12.92], [77.67, 12.8452]]},
            "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "price_policy": {"mode": "split_equal"},
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        })).inserted_id)

        # pax1 fully confirms; pax2 only requests (driver never acts)
        r = await ac.post("/api/v1/bookings", headers=_h(toks[pax]), json={
            "trip_id": trip_id, "seats": 1,
            "pickup_coordinates": [77.5946, 13.0358],
            "dropoff_coordinates": [77.67, 12.8452]})
        b1 = r.json()
        await ac.post("/api/v1/bookings/{}/accept".format(b1["id"]),
                      headers=_h(toks[drv]))
        await ac.post("/api/v1/bookings/{}/confirm".format(b1["id"]),
                      headers=_h(toks[pax]))
        b2 = (await ac.post("/api/v1/bookings", headers=_h(toks[other]), json={
            "trip_id": trip_id, "seats": 2,
            "pickup_coordinates": [77.60, 13.01],
            "dropoff_coordinates": [77.665, 12.87]})).json()

        base = f"/api/v1/trips/{trip_id}"

        # 1. start: published -> ongoing, idempotency guard
        s = await ac.post(base + "/start", headers=_h(toks[drv]))
        assert s.status_code == 200 and s.json()["status"] == "ongoing"
        assert (await ac.post(base + "/start",
                headers=_h(toks[drv]))).status_code == 422
        # non-owner: owner-scoped trip routes hide existence behind 404
        # (same convention as PATCH/publish/cancel in Module 6)
        assert (await ac.post(base + "/start",
                headers=_h(toks[pax]))).status_code == 404

        # 2. complete: receipt with frozen money + auto-rejected request
        c = await ac.post(base + "/complete", headers=_h(toks[drv]))
        assert c.status_code == 200, c.text
        receipt = c.json()
        assert receipt["status"] == "completed"
        assert receipt["seats_sold"] == 1          # only the confirmed rider
        assert receipt["passengers"] == 1
        assert receipt["auto_rejected"] == 1       # pax2's request rejected
        assert receipt["collected_total"] > 0
        assert receipt["duration_min"] is not None
        assert (await db.trips.find_one(
            {"_id": ObjectId(trip_id)}))["completed_at"] is not None

        # 3. closing is not repeatable
        again = await ac.post(base + "/complete", headers=_h(toks[drv]))
        assert again.status_code == 422 and "already" in again.json()["detail"]

        # 4. booking states frozen: confirmed -> completed, requested -> rejected
        b1_doc = await db.bookings.find_one({"_id": ObjectId(b1["id"])})
        b2_doc = await db.bookings.find_one({"_id": ObjectId(b2["id"])})
        assert b1_doc["status"] == "completed"
        assert b1_doc["cost_share"] is not None    # frozen, not zeroed
        assert b2_doc["status"] == "rejected"
        assert b2_doc["closure_note"] == "trip completed"

        # 5. receipt is readable by the rider, blocked for the outsider
        sum_pax = await ac.get(base + "/summary", headers=_h(toks[pax]))
        assert sum_pax.status_code == 200
        assert sum_pax.json()["completed"] is True
        assert (await ac.get(base + "/summary",
                headers=_h(toks[other]))).status_code == 403

        # 6. completed trips accept no new bookings
        r = await ac.post("/api/v1/bookings", headers=_h(toks[other]), json={
            "trip_id": trip_id, "seats": 1,
            "pickup_coordinates": [77.5946, 13.0358],
            "dropoff_coordinates": [77.67, 12.8452]})
        assert r.status_code == 422 and "not open for bookings" in r.json()["detail"]
        _ = pax_id

    for p in (drv, pax, other):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^DoneTest"}})
    await db.bookings.delete_many({})
