"""Module 13 tests: pure leg-splitting + live join/leave recalculation."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.segments import build_segments


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


# 11.1 km straight route; price 6 ₹/km  => total 66.6 for the full ride.
ROUTE = [[0.0, 0.0], [0.05, 0.0], [0.1, 0.0]]
def test_full_rider_pays_more_than_short_hop():
    riders = [
        {"id": "full", "seats": 1, "board_frac": 0.0, "alight_frac": 1.0,
         "board_label": "A", "alight_label": "B"},
        {"id": "hop", "seats": 1, "board_frac": 0.3, "alight_frac": 0.5,
         "board_label": "M1", "alight_label": "M2"},
    ]
    out = build_segments(ROUTE, "A", "B", riders, seats_offered=3,
                         mode="split_equal", price_per_km=6.0)
    assert len(out["segments"]) == 3  # [0,.3] [0.3,.5] [.5,1]
    assert out["segments"][1]["occupant_ids"] == ["full", "hop"]
    assert out["segments"][0]["occupant_ids"] == ["full"]
    assert out["totals"]["hop"] < out["totals"]["full"]
    assert abs(sum(out["totals"].values()) - out["collected_total"]) < 0.01


def test_split_riders_middle_leg_straddler():
    riders = [
        {"id": "r1", "seats": 1, "board_frac": 0.0, "alight_frac": 0.5,
         "board_label": "A", "alight_label": "M"},
        {"id": "r2", "seats": 1, "board_frac": 0.25, "alight_frac": 0.75,
         "board_label": "M1", "alight_label": "M2"},
        {"id": "r3", "seats": 1, "board_frac": 0.5, "alight_frac": 1.0,
         "board_label": "M", "alight_label": "B"},
    ]
    out = build_segments(ROUTE, "A", "B", riders, seats_offered=3,
                         mode="split_riders", price_per_km=10.0)
    mid = [s for s in out["segments"] if abs(s["from_frac"] - 0.25) < 1e-6][0]
    assert sorted(mid["occupant_ids"]) == ["r1", "r2"]
    # r1 rides the first half, r3 the second: near-equal totals
    assert abs(out["totals"]["r1"] - out["totals"]["r3"]) < 0.05
    assert sum(out["totals"].values()) <= out["trip_total_cap"] + 0.01


def test_per_seat_two_seat_rider_pays_double():
    riders = [
        {"id": "solo", "seats": 1, "board_frac": 0.0, "alight_frac": 1.0,
         "board_label": "A", "alight_label": "B"},
        {"id": "duo", "seats": 2, "board_frac": 0.0, "alight_frac": 1.0,
         "board_label": "A", "alight_label": "B"},
    ]
    out = build_segments(ROUTE, "A", "B", riders, seats_offered=3,
                         mode="per_seat", price_per_km=6.0)
    assert abs(out["totals"]["duo"] - 2 * out["totals"]["solo"]) < 0.05
    assert abs(sum(out["totals"].values()) - out["trip_total_cap"]) < 0.05


def test_no_riders_yields_empty_legs():
    out = build_segments(ROUTE, "A", "B", [], seats_offered=3,
                         mode="split_equal", price_per_km=6.0)
    assert out["totals"] == {}
    assert all(s["occupant_ids"] == [] for s in out["segments"])
    assert len(out["segments"]) == 1  # source -> dest only


def test_malformed_rider_is_skipped_not_crashed():
    riders = [
        {"id": "bad", "seats": 1, "board_frac": 0.8, "alight_frac": 0.2,
         "board_label": "X", "alight_label": "Y"},
        {"id": "ok", "seats": 1, "board_frac": 0.0, "alight_frac": 1.0,
         "board_label": "A", "alight_label": "B"},
    ]
    out = build_segments(ROUTE, "A", "B", riders, seats_offered=3,
                         mode="split_equal", price_per_km=6.0)
    assert "bad" not in out["totals"]
    assert out["totals"]["ok"] > 0


@pytest.mark.asyncio
async def test_segment_recalc_on_join_and_leave():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax1, pax2 = "+919000001301", "+919000001302", "+919000001303"
    for p in (drv, pax1, pax2):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^SegTest"}})
    await db.bookings.delete_many({})
    await db.segments.delete_many({})
    await db.vehicles.delete_many({"plate_no": "KA13SEG001"})

    async with _client() as ac:
        for p, name in ((drv, "S Driver"), (pax1, "S Pax One"), (pax2, "S Pax Two")):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": name, "roles": ["driver", "passenger"]})).status_code == 201
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
            "make": "Honda", "model": "City", "plate_no": "KA13SEG001",
            "seats_total": 3, "fuel_type": "petrol", "mileage_kmpl": 18.0})).json()["id"]
        await db.vehicles.update_one({"_id": ObjectId(vid)},
                                     {"$set": {"verification_status": "verified"}})

        now = datetime.now(timezone.utc)
        route = {"type": "LineString", "coordinates": [
            [77.5946, 13.0358], [77.62, 13.0], [77.65, 12.92], [77.67, 12.8452]]}
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid_drv), "vehicle_id": ObjectId(vid),
            "source": {"name": "SegTest A", "point": {"type": "Point",
                       "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "SegTest B", "point": {"type": "Point",
                            "coordinates": [77.67, 12.8452]}},
            "route_geometry": route, "distance_km": 30.0, "duration_min": 50.0,
            "depart_at": now + timedelta(days=7), "seats_offered": 3,
            "seats_booked": 0, "status": "published", "price_policy": None,
            "created_at": now, "updated_at": now,
        })).inserted_id)

        async def book_confirm(tok, pick, drop):
            b = (await ac.post("/api/v1/bookings", headers=tok, json={
                "trip_id": trip_id, "seats": 1,
                "pickup_coordinates": pick, "dropoff_coordinates": drop})).json()
            assert "id" in b, b
            await ac.post(f"/api/v1/bookings/{b['id']}/accept", headers=_h(t_drv))
            await ac.post(f"/api/v1/bookings/{b['id']}/confirm", headers=tok)
            return b["id"]

        # pax1: full ride -> one leg (source->dest), share = total / 2
        b1 = await book_confirm(_h(t1), [77.5946, 13.0358], [77.67, 12.8452])
        stored1 = await db.bookings.find_one({"_id": ObjectId(b1)})
        solo_share = stored1["cost_share"]
        assert solo_share and solo_share > 0
        segs = await db.segments.find({"trip_id": ObjectId(trip_id)}).to_list(20)
        assert len(segs) == 1

        # pax2: short hop inside the corridor -> stops split the route
        b2 = await book_confirm(_h(t2), [77.615, 13.005], [77.65, 12.92])
        segs = sorted(await db.segments.find({"trip_id": ObjectId(trip_id)}).to_list(20),
                      key=lambda s: s["seq"])
        assert len(segs) >= 3
        stored1 = await db.bookings.find_one({"_id": ObjectId(b1)})
        stored2 = await db.bookings.find_one({"_id": ObjectId(b2)})
        assert 0 < stored2["cost_share"] < stored1["cost_share"]
        assert stored1["cost_share"] < solo_share  # recalculation happened

        # rebuild is idempotent (unique trip+seq index would explode otherwise)
        r = await ac.post(f"/api/v1/trips/{trip_id}/segments/rebuild",
                          headers=_h(t_drv))
        assert r.status_code == 200 and r.json()["rebuilt"] is True
        again = await db.segments.find({"trip_id": ObjectId(trip_id)}).to_list(20)
        assert len(again) == len(segs)

        # summary endpoint feeds the driver toggle
        s = await ac.get(f"/api/v1/trips/{trip_id}/segments/summary", headers=_h(t1))
        assert s.status_code == 200, s.text
        assert s.json()["segmented"] is True
        assert len(s.json()["segments"]) == len(segs)

        # passenger cannot rebuild someone else's trip -> 403
        assert (await ac.post(f"/api/v1/trips/{trip_id}/segments/rebuild",
                headers=_h(t1))).status_code == 403

        # pax2 cancels -> collapse back; pax1's share returns to solo value
        await ac.post(f"/api/v1/bookings/{b2}/cancel", headers=_h(t2))
        stored1 = await db.bookings.find_one({"_id": ObjectId(b1)})
        assert abs(stored1["cost_share"] - solo_share) < 0.05
        left = await db.segments.find({"trip_id": ObjectId(trip_id)}).to_list(20)
        assert len(left) <= len(segs)

    for p in (drv, pax1, pax2):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^SegTest"}})
    await db.bookings.delete_many({})
    await db.segments.delete_many({})
    await db.vehicles.delete_many({"plate_no": "KA13SEG001"})