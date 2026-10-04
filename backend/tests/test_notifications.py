"""Module 23 tests: event catalog rules (pure) + the notification feed (live).

The live test walks a real ride — request, accept, SOS, complete — and checks
that the RIGHT person was told, exactly once for derived facts, every time for
SOS, and never a stranger.
"""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.notify import (
    EVENT_CATALOG,
    PRIORITY_RANK,
    dedupe_key,
    render,
    sorted_feed,
    unread_summary,
    unknown_event,
)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


# --------------------------------------------------------------------------
# pure rules
# --------------------------------------------------------------------------

def test_every_catalog_event_renders():
    """No template may reference a placeholder render() cannot fill."""
    for name in EVENT_CATALOG:
        out = render(name)
        assert out is not None, name
        assert out["type"] == name
        assert out["title"] and out["body"]
        assert out["priority"] in PRIORITY_RANK
        assert "{" not in out["title"] and "{" not in out["body"], name


def test_render_uses_context_and_defaults():
    out = render("booking_accepted", {"driver": "Asha", "route": "A → B"})
    assert "Asha" in out["body"] and "A → B" in out["body"]
    # missing values fall back instead of leaking "None" into the UI
    out = render("sos", {})
    assert "Someone" in out["body"] and "None" not in out["body"]
    assert render("booking_completed_unknown") is None
    assert unknown_event("booking_completed_unknown") is True


def test_dedupe_key_rules():
    # derived facts are anchored to the thing
    assert dedupe_key("booking_accepted", {"booking_id": "b1"}) == \
        "booking_accepted:b1"
    assert dedupe_key("safety_alert", {"trip_id": "t1", "kind": "speed"}) == \
        "safety_alert:t1-speed"
    # SOS and alert lifecycle are NEVER deduped -> None means "always insert"
    assert dedupe_key("sos", {"trip_id": "t1"}) is None
    assert dedupe_key("alert_acknowledged", {"trip_id": "t1"}) is None
    # no anchor -> no key, so the event is not silently merged
    assert dedupe_key("booking_accepted", {}) is None


def test_unread_summary_and_sorting():
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    rows = [
        {"type": "booking_accepted", "priority": "normal", "created_at": now},
        {"type": "sos", "priority": "critical", "created_at": now},
        {"type": "booking_rejected", "priority": "normal",
         "created_at": now, "read_at": now},
    ]
    s = unread_summary(rows)
    assert s["unread"] == 2 and s["critical"] == 1
    assert s["by_type"] == {"booking_accepted": 1, "sos": 1}
    # unread first, then critical before normal
    feed = [r["type"] for r in sorted_feed(rows)]
    assert feed == ["sos", "booking_accepted", "booking_rejected"]
    assert len(sorted_feed(rows, limit=2)) == 2


# --------------------------------------------------------------------------
# live flow
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notification_flow_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax, other, admin = ("+919000002301", "+919000002302",
                              "+919000002303", "+919000002304")
    for p in (drv, pax, other, admin):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^NoteTest"}})
    await db.bookings.delete_many({})
    await db.notifications.delete_many({})

    async with _client() as ac:
        toks = {}
        for p in (drv, pax, other, admin):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Note " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        for p in (drv, pax, other, admin):
            toks[p] = (await ac.post("/api/v1/auth/login", json={
                "phone": p, "password": "pass1234"})).json()["access_token"]
        await db.users.update_one({"phone": admin},
                                  {"$addToSet": {"roles": "admin"}})
        toks[admin] = (await ac.post("/api/v1/auth/login", json={
            "phone": admin, "password": "pass1234"})).json()["access_token"]

        now = datetime.now(timezone.utc)
        depart = (now + timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0)
        drv_id = (await ac.get("/api/v1/auth/me",
                    headers=_h(toks[drv]))).json()["id"]
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(drv_id), "vehicle_id": ObjectId(),
            "source": {"name": "NoteTest A", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "NoteTest B", "point": {"type": "Point",
                             "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0],
                [77.65, 12.92], [77.67, 12.8452]]},
            "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "created_at": now, "updated_at": now,
        })).inserted_id)

        # 1. request -> the DRIVER is told, the passenger is not
        booking = (await ac.post("/api/v1/bookings", headers=_h(toks[pax]),
                   json={"trip_id": trip_id, "seats": 1,
                         "pickup_coordinates": [77.5946, 13.0358],
                         "dropoff_coordinates": [77.67, 12.8452]})).json()
        drv_feed = (await ac.get("/api/v1/notifications",
                    headers=_h(toks[drv]))).json()
        assert drv_feed["unread"] == 1
        assert drv_feed["items"][0]["type"] == "booking_requested"
        assert "Note 302" in drv_feed["items"][0]["body"]   # the passenger's name
        assert (await ac.get("/api/v1/notifications",
                headers=_h(toks[pax]))).json()["unread"] == 0  # no self-notify
        assert (await ac.get("/api/v1/notifications",
                headers=_h(toks[other]))).json()["unread"] == 0  # stranger


        # 2. accept -> the PASSENGER is told; the request fact is not repeated
        await ac.post("/api/v1/bookings/{}/accept".format(booking["id"]),
                      headers=_h(toks[drv]))
        pax_feed = (await ac.get("/api/v1/notifications",
                    headers=_h(toks[pax]))).json()
        assert pax_feed["unread"] == 1
        assert pax_feed["items"][0]["type"] == "booking_accepted"
        assert (await ac.get("/api/v1/notifications",
                headers=_h(toks[drv]))).json()["unread"] == 1

        # 3. SOS -> driver AND admin, critical, and NEVER deduped
        for _ in range(2):
            r = await ac.post("/api/v1/safety/sos", headers=_h(toks[pax]),
                              json={"trip_id": trip_id, "message": "help"})
            assert r.status_code == 200, r.text
        admin_feed = (await ac.get("/api/v1/notifications",
                      headers=_h(toks[admin]))).json()
        assert admin_feed["by_type"] == {"sos": 2}      # both presses landed
        assert admin_feed["critical"] == 2
        drv_feed = (await ac.get("/api/v1/notifications",
                    headers=_h(toks[drv]))).json()
        assert drv_feed["by_type"] == {"booking_requested": 1, "sos": 2}

        # 4. a re-emitted KEY event does not duplicate (idempotent hook)
        from app.api.v1.notifications import emit, notify_booking

        bdoc = await db.bookings.find_one({"_id": ObjectId(booking["id"])})
        again = await notify_booking(db, "booking_accepted", bdoc)
        assert again["emitted"] == 0   # already delivered
        assert (await ac.get("/api/v1/notifications",
                headers=_h(toks[pax]))).json()["unread"] == 1

        # 5. completion -> the rider is nudged to rate (feeds Module 22)
        await db.bookings.update_one({"_id": ObjectId(booking["id"])},
                                     {"$set": {"status": "confirmed"}})
        c = await ac.post("/api/v1/trips/{}/complete".format(trip_id),
                          headers=_h(toks[drv]))
        assert c.status_code == 200, c.text
        pax_feed = (await ac.get("/api/v1/notifications",
                    headers=_h(toks[pax]))).json()
        done = [i for i in pax_feed["items"] if i["type"] == "trip_completed"]
        assert len(done) == 1
        assert done[0]["action"] == "rate"   # the bell deep-links to Module 22

        # 6. an unknown event type is ignored, never a 500
        bad = await emit(db, "not_a_real_event", trip_id=trip_id)
        assert bad["emitted"] == 0 and "unknown event" in bad["error"]

        # 7. read state: one, then all — and only my own
        first = pax_feed["items"][0]["id"]
        r = await ac.post("/api/v1/notifications/{}/read".format(first),
                          headers=_h(toks[pax]))
        assert r.status_code == 200 and r.json()["read_at"] is not None
        # someone else's notification is simply not there
        drv_items = (await ac.get("/api/v1/notifications",
                      headers=_h(toks[drv]))).json()["items"]
        assert (await ac.post(
            "/api/v1/notifications/{}/read".format(drv_items[0]["id"]),
            headers=_h(toks[pax]))).status_code == 404
        summary = (await ac.get("/api/v1/notifications/summary",
                   headers=_h(toks[pax]))).json()
        assert summary["unread"] == 1        # two left, one just read
        allread = await ac.post("/api/v1/notifications/read-all",
                                headers=_h(toks[pax]))
        assert allread.status_code == 200
        assert (await ac.get("/api/v1/notifications/summary",
                headers=_h(toks[pax]))).json()["unread"] == 0
        # read-all is scoped: the driver's feed is untouched
        assert (await ac.get("/api/v1/notifications/summary",
                headers=_h(toks[drv]))).json()["unread"] == 3

    for p in (drv, pax, other, admin):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^NoteTest"}})
    await db.bookings.delete_many({})
    await db.notifications.delete_many({})
