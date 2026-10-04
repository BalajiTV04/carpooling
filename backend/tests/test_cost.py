"""Module 12 tests: cost math (pure) + pricing/share flow (live)."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.cost import (
    distribute,
    passenger_share,
    resolve_fuel_price,
    total_fuel_cost,
)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def test_total_fuel_cost_blr_corridor():
    # 30 km @ 18 kmpl petrol 104.5 = 30/18*104.5 = 174.17
    out = total_fuel_cost(30.0, 18.0, 104.5)
    assert abs(out["total_cost"] - 174.17) < 0.02
    assert out["litres"] == round(30.0 / 18.0, 2)
    assert out["per_km"] == round(174.17 / 30.0, 2)


def test_total_fuel_cost_missing_mileage_uses_default():
    out = total_fuel_cost(30.0, None, 100.0)
    assert abs(out["total_cost"] - 30.0 / 15.0 * 100.0) < 0.01
    assert out["total_cost"] > 0


def test_policies_never_exceed_total():
    total = 200.0
    # full car under each policy
    assert sum(passenger_share("split_equal", total, 3, 1, 3, 3) for _ in range(3)) <= total
    assert abs(sum(passenger_share("per_seat", total, 3, 1, 3, 3) for _ in range(3)) - total) < 0.05
    assert abs(sum(passenger_share("split_riders", total, 3, 1, 3, 3) for _ in range(3)) - total) < 0.05


def test_split_equal_shrinks_as_more_join():
    one = passenger_share("split_equal", 200.0, 3, 1, 1, 1)
    three = passenger_share("split_equal", 200.0, 3, 1, 3, 3)
    assert one == 100.0 and three == 50.0


def test_per_seat_stable_as_more_join():
    a = passenger_share("per_seat", 200.0, 4, 2, 2, 1)
    b = passenger_share("per_seat", 200.0, 4, 2, 4, 2)
    assert a == b == 100.0


def test_distribute_rounding_residue_absorbed():
    shares = distribute("per_seat", 100.0, 3,
                        [{"id": "a", "seats": 1}, {"id": "b", "seats": 1},
                         {"id": "c", "seats": 1}])
    assert abs(sum(shares.values()) - 100.0) < 0.02  # 33.33×3 residue lands on last



@pytest.mark.asyncio
async def test_cost_flow():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax1, pax2 = "+919000001201", "+919000001202", "+919000001203"
    for p in (drv, pax1, pax2):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^CostTest"}})
    await db.bookings.delete_many({})
    await db.vehicles.delete_many({"plate_no": "KA12COST01"})

    async with _client() as ac:
        for p, name in ((drv, "C Driver"), (pax1, "C Pax One"), (pax2, "C Pax Two")):
            r = await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": name, "roles": ["driver", "passenger"]})
            assert r.status_code == 201, r.text
            t = (await ac.post("/api/v1/auth/login",
                 json={"phone": p, "password": "pass1234"})).json()["access_token"]
            _ = t  # (per-role tokens fetched below; this one just warms the cache)
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t1 = (await ac.post("/api/v1/auth/login",
              json={"phone": pax1, "password": "pass1234"})).json()["access_token"]
        t2 = (await ac.post("/api/v1/auth/login",
              json={"phone": pax2, "password": "pass1234"})).json()["access_token"]
        uid_drv = (await ac.get("/api/v1/auth/me", headers=_h(t_drv))).json()["id"]

        vid = (await ac.post("/api/v1/vehicles", headers=_h(t_drv), json={
            "make": "Honda", "model": "City", "plate_no": "KA12COST01",
            "seats_total": 3, "fuel_type": "petrol", "mileage_kmpl": 18.0})).json()["id"]
        await db.vehicles.update_one({"_id": ObjectId(vid)},
                                     {"$set": {"verification_status": "verified"}})

        now = datetime.now(timezone.utc)
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid_drv), "vehicle_id": ObjectId(vid),
            "source": {"name": "CostTest A", "point": {"type": "Point",
                       "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "CostTest B", "point": {"type": "Point",
                            "coordinates": [77.67, 12.8452]}},
            "route_geometry": None, "distance_km": 30.0, "duration_min": None,
            "depart_at": now + timedelta(days=6), "seats_offered": 3,
            "seats_booked": 0, "status": "published",
            "created_at": now, "updated_at": now,
        })).inserted_id)
        body = {"trip_id": trip_id, "seats": 1,
                "pickup_coordinates": [77.60, 13.01],
                "dropoff_coordinates": [77.665, 12.87]}

        # 1. default pricing: split_equal, petrol price, total = 30/18*104.5
        r = await ac.get(f"/api/v1/trips/{trip_id}/cost", headers=_h(t_drv))
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["policy"]["mode"] == "split_equal"
        assert abs(c["fuel"]["total_cost"] - 174.17) < 0.05
        assert c["projected_share_if_book_1_seat_now"] == round(174.17 / 2, 2)

        # 2. book 1 seat (requested) -> no cost share yet (not accepted);
        #    accept -> cost_share persisted = total/2
        b1 = (await ac.post("/api/v1/bookings", json=body, headers=_h(t1))).json()
        assert b1["cost_share"] is None
        await ac.post(f"/api/v1/bookings/{b1['id']}/accept", headers=_h(t_drv))
        await ac.post(f"/api/v1/bookings/{b1['id']}/confirm", headers=_h(t1))
        stored = await db.bookings.find_one({"_id": ObjectId(b1["id"])})
        assert abs(stored["cost_share"] - round(174.17 / 2, 2)) < 0.05

        # 3. second passenger joins (accept+confirm) -> both now pay /3
        b2 = (await ac.post("/api/v1/bookings", json=body, headers=_h(t2))).json()
        await ac.post(f"/api/v1/bookings/{b2['id']}/accept", headers=_h(t_drv))
        await ac.post(f"/api/v1/bookings/{b2['id']}/confirm", headers=_h(t2))
        stored1 = await db.bookings.find_one({"_id": ObjectId(b1["id"])})
        stored2 = await db.bookings.find_one({"_id": ObjectId(b2["id"])})
        assert abs(stored1["cost_share"] - round(174.17 / 3, 2)) < 0.05
        assert abs(stored2["cost_share"] - round(174.17 / 3, 2)) < 0.05

        # 4. booking-level breakdown carries the formula
        r = await ac.get(f"/api/v1/bookings/{b1['id']}/cost", headers=_h(t1))
        assert r.status_code == 200
        assert "total / (1 + passengers)" in r.json()["formula"]

        # 5. per_seat policy switch -> reshare is stable per seat: 174.17/3
        assert (await ac.post(f"/api/v1/trips/{trip_id}/pricing",
                json={"mode": "per_seat"}, headers=_h(t_drv))).status_code == 200
        r = await ac.get(f"/api/v1/trips/{trip_id}/cost", headers=_h(t_drv))
        assert round(174.17 / 3, 2) in r.json()["shares"].values()
        # bad mode -> 422; stranger cannot price -> 403
        assert (await ac.post(f"/api/v1/trips/{trip_id}/pricing",
                json={"mode": "lottery"}, headers=_h(t_drv))).status_code == 422
        assert (await ac.post(f"/api/v1/trips/{trip_id}/pricing",
                json={"mode": "per_seat"}, headers=_h(t1))).status_code == 403

    for p in (drv, pax1, pax2):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^CostTest"}})
    await db.bookings.delete_many({})
    await db.vehicles.delete_many({"plate_no": "KA12COST01"})
def test_resolve_fuel_price_policy_wins():
    assert resolve_fuel_price("petrol", {"fuel_price": 110.0}) == 110.0
    assert resolve_fuel_price("diesel", None) > 0
    assert resolve_fuel_price("unknown-fuel", None) == resolve_fuel_price("petrol", None)
