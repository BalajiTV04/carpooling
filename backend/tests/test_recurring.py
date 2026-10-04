"""Module 15 tests: recurrence date math (pure) + series lifecycle (live)."""

import pytest
from datetime import date
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.recurring import describe, materialise_dates


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


START = date(2030, 6, 3)  # a Monday


def test_daily_materialisation_with_cap():
    dates = materialise_dates("daily", START, horizon_days=7, max_days=90)
    assert len(dates) == 7 and dates[0] == START and dates[-1] == date(2030, 6, 9)


def test_weekdays_skip_weekend():
    dates = materialise_dates("weekdays", START, horizon_days=7, max_days=90)
    assert [d.weekday() for d in dates] == [0, 1, 2, 3, 4]  # Mon..Fri only


def test_weekly_specific_days_and_stops_on():
    dates = materialise_dates("weekly", START, stops_on="2030-06-16",
                              weekly_days=[0, 3], horizon_days=90, max_days=90)
    assert all(d.weekday() in (0, 3) for d in dates)
    assert dates[0] == START and dates[-1] == date(2030, 6, 13)
    assert len(dates) == 4  # Jun 3, 6, 10, 13


def test_stops_on_before_start_yields_empty_and_bad_rule_raises():
    assert materialise_dates("daily", START, stops_on="2030-06-01") == []
    try:
        materialise_dates("monthly", START)
        raise AssertionError("should raise")
    except ValueError:
        pass


def test_describe_labels():
    assert describe("daily") == "Every day"
    assert "Mon-Fri" in describe("weekdays")
    assert "Mon" in describe("weekly", [0, 3]) and "Thu" in describe("weekly", [0, 3])


@pytest.mark.asyncio
async def test_series_lifecycle_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax = "+919000001501", "+919000001502"
    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^RecTest"}})
    await db.bookings.delete_many({})
    await db.recurring_groups.delete_many({})

    async with _client() as ac:
        for p in (drv, pax):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Rec " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t_pax = (await ac.post("/api/v1/auth/login",
                 json={"phone": pax, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me", headers=_h(t_drv))).json()["id"]

        base_depart = (datetime.now(timezone.utc) + timedelta(days=1)
                       ).replace(hour=7, minute=30, second=0, microsecond=0)
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
            "source": {"name": "RecTest A", "point": {"type": "Point",
                       "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "RecTest B", "point": {"type": "Point",
                            "coordinates": [77.67, 12.8452]}},
            "route_geometry": None, "distance_km": 27.0, "duration_min": 48.0,
            "depart_at": base_depart, "seats_offered": 2, "seats_booked": 0,
            "status": "published", "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        })).inserted_id)

        # 1. weekday series with a 14-day horizon
        r = await ac.post(f"/api/v1/trips/{trip_id}/recurring", headers=_h(t_drv),
                          json={"rule": "weekdays", "horizon_days": 14})
        assert r.status_code == 200, r.text
        group_id = r.json()["group_id"]
        n_dates = len(r.json()["dates"])
        assert n_dates >= 5
        assert (await db.trips.find_one(
            {"_id": ObjectId(trip_id)}))["recurring_group_id"] == group_id
        assert await db.trips.count_documents(
            {"recurring_group_id": group_id}) == n_dates

        # 2. duplicate series -> 409; passenger -> 403
        assert (await ac.post(f"/api/v1/trips/{trip_id}/recurring", headers=_h(t_drv),
                json={"rule": "daily"})).status_code == 409
        assert (await ac.post(f"/api/v1/trips/{trip_id}/recurring", headers=_h(t_pax),
                json={"rule": "daily"})).status_code == 403
        tok_drv, tok_pax = t_drv, t_pax
        _ = (tok_drv, tok_pax)

        # 3. month pass: booking on every upcoming instance
        r = await ac.post(f"/api/v1/recurring/{group_id}/book", headers=_h(t_pax),
                          json={"seats": 1,
                                "pickup_coordinates": [77.60, 13.01],
                                "dropoff_coordinates": [77.665, 12.87]})
        assert r.status_code == 200, r.text
        month = r.json()
        ok_dates = [d for d in month["dates"] if d.get("ok")]
        assert len(ok_dates) == month["requested"] >= 1
        first_ok = await db.trips.find_one({"_id": ObjectId(ok_dates[0]["trip_id"])})
        assert first_ok["seats_booked"] == 1
        # re-run: per-date idempotent ("already booked"), no double reservation
        r2 = await ac.post(f"/api/v1/recurring/{group_id}/book", headers=_h(t_pax),
                           json={"seats": 1,
                                 "pickup_coordinates": [77.60, 13.01],
                                 "dropoff_coordinates": [77.665, 12.87]})
        again = r2.json()
        assert all(not d.get("ok") for d in again["dates"])
        assert all(d.get("reason") == "already booked" for d in again["dates"])

        # 4. summary counts
        s = (await ac.get(f"/api/v1/recurring/{group_id}", headers=_h(t_drv))).json()
        assert s["active"] is True
        assert s["counts"]["with_bookings"] >= 1
        assert s["counts"]["upcoming"] >= month["requested"]

        # 5. stop the series: booked instances kept, unbooked future cancelled
        r = await ac.delete(f"/api/v1/recurring/{group_id}", headers=_h(t_drv))
        assert r.status_code == 200
        assert r.json()["kept_with_bookings"] == month["requested"]
        assert (await db.recurring_groups.find_one(
            {"group_id": group_id}))["active"] is False
        # booking into a stopped series -> 422
        assert (await ac.post(f"/api/v1/recurring/{group_id}/book", headers=_h(t_pax),
                json={"seats": 1, "pickup_coordinates": [77.60, 13.01],
                      "dropoff_coordinates": [77.665, 12.87]})).status_code == 422
        # extend after stop -> 422
        assert (await ac.post(f"/api/v1/recurring/{group_id}/extend",
                headers=_h(t_drv))).status_code == 422

    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^RecTest"}})
    await db.bookings.delete_many({})
    await db.recurring_groups.delete_many({})