"""Module 14 tests: advance-booking window (pure math + live enforcement)."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.booking_window import check_window, normalise_policy, window


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def test_window_math_defaults():
    from datetime import datetime, timedelta, timezone

    depart = datetime(2030, 6, 1, 9, 0, tzinfo=timezone.utc)
    w = window(depart, None)
    assert w["policy"]["max_days_advance"] == 30
    assert w["policy"]["min_notice_min"] == 60
    assert w["opens_at"] == depart - timedelta(days=30)
    assert w["closes_at"] == depart - timedelta(minutes=60)


def test_check_window_states():
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    pol = {"max_days_advance": 30, "min_notice_min": 60}
    far = now + timedelta(days=40)
    assert check_window(far, pol, now)["bookable"] is False
    assert "opens" in check_window(far, pol, now)["reason"]
    good = now + timedelta(days=2)
    r = check_window(good, pol, now)
    assert r["bookable"] is True and r["reason"] is None
    soon = now + timedelta(minutes=30)
    assert "closed" in check_window(soon, pol, now)["reason"]
    past = now - timedelta(hours=1)
    assert "departed" in check_window(past, pol, now)["reason"]


def test_normalise_policy_clamps():
    assert normalise_policy({"max_days_advance": 999, "min_notice_min": -5}) \
        == {"max_days_advance": 180, "min_notice_min": 0}
    assert normalise_policy({"max_days_advance": "abc"})["max_days_advance"] == 30
    assert normalise_policy(None)["min_notice_min"] == 60


@pytest.mark.asyncio
async def test_advance_window_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax = "+919000001401", "+919000001402"
    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^AdvTest"}})
    await db.bookings.delete_many({})

    async with _client() as ac:
        for p in (drv, pax):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Adv " + p[-3:], "roles": ["driver", "passenger"]
            })).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t_pax = (await ac.post("/api/v1/auth/login",
                 json={"phone": pax, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me", headers=_h(t_drv))).json()["id"]

        async def mk_trip(name, depart, policy):
            return str((await db.trips.insert_one({
                "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
                "source": {"name": name, "point": {"type": "Point",
                           "coordinates": [77.5946, 13.0358]}},
                "destination": {"name": "AdvTest B", "point": {"type": "Point",
                                "coordinates": [77.67, 12.8452]}},
                "route_geometry": None, "distance_km": 27.0, "duration_min": 48.0,
                "depart_at": depart, "seats_offered": 2, "seats_booked": 0,
                "status": "published", "advance_policy": policy,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            })).inserted_id)

        now = datetime.now(timezone.utc)
        open_trip = await mk_trip("AdvTest Open", now + timedelta(days=2),
                                  {"max_days_advance": 30, "min_notice_min": 60})
        closed_trip = await mk_trip("AdvTest Closed", now + timedelta(minutes=90),
                                    {"max_days_advance": 30, "min_notice_min": 120})
        early_trip = await mk_trip("AdvTest Early", now + timedelta(days=40),
                                   {"max_days_advance": 30, "min_notice_min": 60})

        # 1. bookability endpoint mirrors the pure logic
        b = (await ac.get(f"/api/v1/trips/{open_trip}/bookability",
                          headers=_h(t_pax))).json()
        assert b["bookable"] is True
        b = (await ac.get(f"/api/v1/trips/{closed_trip}/bookability",
                          headers=_h(t_pax))).json()
        assert b["bookable"] is False and "closed" in b["reason"]
        b = (await ac.get(f"/api/v1/trips/{early_trip}/bookability",
                          headers=_h(t_pax))).json()
        assert b["bookable"] is False and "opens" in b["reason"]

        # 2. booking outside the window is rejected with the same reason
        body = {"trip_id": closed_trip, "seats": 1,
                "pickup_coordinates": [77.60, 13.01],
                "dropoff_coordinates": [77.665, 12.87]}
        r = await ac.post("/api/v1/bookings", json=body, headers=_h(t_pax))
        assert r.status_code == 422 and "closed" in r.json()["detail"]
        body["trip_id"] = early_trip
        r = await ac.post("/api/v1/bookings", json=body, headers=_h(t_pax))
        assert r.status_code == 422 and "opens" in r.json()["detail"]

        # 3. search hides window-closed trips behind a reason (their own day)
        q = {"src_coordinates": [77.5946, 13.0358],
             "dst_coordinates": [77.67, 12.8452],
             "date": (now + timedelta(minutes=90)).strftime("%Y-%m-%d"),
             "include_excluded": True}
        r = await ac.post("/api/v1/search/rides", json=q, headers=_h(t_pax))
        body_j = r.json()
        assert body_j["count"] == 0  # closed trip is not bookable
        reasons = [e.get("reason", "") for e in body_j.get("excluded", [])]
        assert any("window:" in x for x in reasons)

        # 4. driver sets the policy; passenger cannot
        r = await ac.post(f"/api/v1/trips/{open_trip}/advance-policy"
                          "?max_days_advance=7&min_notice_min=30", headers=_h(t_drv))
        assert r.status_code == 200
        assert r.json()["advance_policy"] == {"max_days_advance": 7, "min_notice_min": 30}
        assert (await ac.post(f"/api/v1/trips/{open_trip}/advance-policy",
                headers=_h(t_pax))).status_code == 403

        # 5. notice 0 allows a 5-minutes-away trip
        last_trip = await mk_trip("AdvTest Last", now + timedelta(minutes=5),
                                  {"max_days_advance": 30, "min_notice_min": 0})
        r = await ac.get(f"/api/v1/trips/{last_trip}/bookability", headers=_h(t_pax))
        assert r.json()["bookable"] is True

    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^AdvTest"}})
    await db.bookings.delete_many({})
