"""Module 20 tests: push hub units + a real two-socket WebSocket flow.

The socket test uses starlette's TestClient (sync) because httpx cannot speak
WebSocket; DB seeding runs through asyncio.run, so the Motor loop-safety
rebuild in core/database.py is exercised too.
"""
import asyncio

import pytest
from httpx import AsyncClient, ASGITransport
from starlette.testclient import TestClient

from app.main import app
from app.services.hub import LiveHub, json_safe


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


class DeadWS:
    def __init__(self):
        self.calls = 0

    async def send_json(self, payload):
        self.calls += 1
        raise RuntimeError("socket is gone")


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


@pytest.mark.filterwarnings("ignore::pytest.PytestUnraisableExceptionWarning")
def test_json_safe_prevents_the_silent_unsubscribe_bug():
    """Regression: a raw datetime in a frame used to raise inside send_json and
    (because the hub drops failing sockets) silently unsubscribe EVERY watcher.
    """
    import json
    from datetime import datetime, timezone

    from bson import ObjectId
    payload = {"type": "fix",
               "fix": {"recorded_at": datetime(2030, 6, 1, 9, 0,
                                               tzinfo=timezone.utc)},
               "trip_id": ObjectId("64f000000000000000000001"),
               "nested": [{"when": datetime(2030, 6, 1, 9, 0,
                                            tzinfo=timezone.utc)}],
               "mixed": ("a", 1, None, True)}
    safe = json_safe(payload)
    text = json.dumps(safe)                      # must not raise
    assert "2030-06-01T09:00:00" in text
    assert safe["trip_id"] == "64f000000000000000000001"
    assert safe["nested"][0]["when"] == "2030-06-01T09:00:00+00:00"
    assert json_safe(None) is None and json_safe(3.5) == 3.5


@pytest.mark.asyncio
async def test_hub_broadcast_survives_datetime_payload():
    hub = LiveHub()
    ws = FakeWS()
    await hub.subscribe("t1", ws)
    from datetime import datetime, timezone
    delivered = await hub.broadcast("t1", {"at": datetime.now(timezone.utc)})
    assert delivered == 1 and hub.dropped == 0
    assert isinstance(ws.sent[0]["at"], str)


@pytest.mark.asyncio
async def test_hub_subscribe_broadcast_isolation():
    hub = LiveHub()
    a, b, other = FakeWS(), FakeWS(), FakeWS()
    assert await hub.subscribe("t1", a) == 1
    assert await hub.subscribe("t1", b) == 2
    await hub.subscribe("t2", other)
    assert hub.subscriber_count("t1") == 2
    delivered = await hub.broadcast("t1", {"type": "fix", "n": 1})
    assert delivered == 2
    assert len(a.sent) == 1 and len(b.sent) == 1
    assert other.sent == []            # trips are isolated
    assert await hub.unsubscribe("t1", a) == 1
    assert await hub.broadcast("t1", {"n": 2}) == 1
    assert hub.trips_with_subscribers() == ["t1", "t2"]
    assert hub.stats()["pushed"] == 3


@pytest.mark.asyncio
async def test_hub_drops_dead_sockets_without_raising():
    hub = LiveHub()
    dead, alive = DeadWS(), FakeWS()
    await hub.subscribe("t1", dead)
    await hub.subscribe("t1", alive)
    delivered = await hub.broadcast("t1", {"type": "fix"})
    assert delivered == 1                      # dead socket did not break it
    assert hub.stats()["dropped"] == 1
    assert hub.subscriber_count("t1") == 1     # and it was unsubscribed


def _ping():
    async def inner():
        from app.core.database import ping_db
        return await ping_db()
    return asyncio.run(inner())


def _seed(phones):
    async def inner():
        from datetime import datetime, timedelta, timezone

        from bson import ObjectId

        from app.core.database import get_db
        from app.core.security import hash_password

        db = get_db()
        now = datetime.now(timezone.utc)
        ids = {}
        for i, p in enumerate(phones):
            await db.users.delete_many({"phone": p})
            res = await db.users.insert_one({
                "phone": p, "password_hash": hash_password("pass1234"),
                "full_name": "Stream " + p[-3:],
                "roles": ["driver", "passenger"], "phone_verified": True,
                "rating_avg": None, "rating_count": 0, "status": "active",
                "created_at": now, "updated_at": now})
            ids[p] = str(res.inserted_id)
        await db.trips.delete_many({"source.name": {"$regex": "^StreamTest"}})
        await db.bookings.delete_many({})
        await db.locations.delete_many({"trip_id": {"$exists": True}})
        depart = (now + timedelta(days=1)).replace(hour=9, minute=0,
                                                   second=0, microsecond=0)
        trip = await db.trips.insert_one({
            "driver_id": ObjectId(ids[phones[0]]), "vehicle_id": ObjectId(),
            "source": {"name": "StreamTest A", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "StreamTest B", "point": {"type": "Point",
                             "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0],
                [77.65, 12.92], [77.67, 12.8452]]},
            "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "created_at": now, "updated_at": now})
        # passenger 1 holds a booking (audience); passenger 2 does not
        await db.bookings.insert_one({
            "trip_id": trip.inserted_id,
            "passenger_id": ObjectId(ids[phones[1]]),
            "driver_id": ObjectId(ids[phones[0]]), "seats": 1,
            "status": "confirmed",
            "pickup": {"point": {"type": "Point",
                                 "coordinates": [77.5946, 13.0358]}},
            "dropoff": {"point": {"type": "Point",
                                  "coordinates": [77.67, 12.8452]}},
            "created_at": now, "updated_at": now})
        return {"trip_id": str(trip.inserted_id)}
    return asyncio.run(inner())


def _cleanup(phones):
    async def inner():
        from app.core.database import get_db
        db = get_db()
        for p in phones:
            await db.users.delete_many({"phone": p})
        await db.trips.delete_many({"source.name": {"$regex": "^StreamTest"}})
        await db.bookings.delete_many({})
    asyncio.run(inner())


def _token(client, phone):
    r = client.post("/api/v1/auth/login",
                    json={"phone": phone, "password": "pass1234"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _next_of_type(ws, kind, tries=6):
    """Skip frames of other types (the sender sees its own broadcast too)."""
    for _ in range(tries):
        msg = ws.receive_json()
        if msg.get("type") == kind:
            return msg
    raise AssertionError("no " + kind + " frame arrived")


@pytest.mark.filterwarnings("ignore::pytest.PytestUnraisableExceptionWarning")
def test_stream_socket_push_flow():
    from bson import ObjectId
    from starlette.websockets import WebSocketDisconnect

    from app.core.database import get_db

    if not _ping():
        pytest.skip("Mongo down")
    drv, pax, outsider = "+919000002001", "+919000002002", "+919000002003"
    ids = _seed((drv, pax, outsider))
    trip_id = ids["trip_id"]
    try:
        with TestClient(app) as client:
            t_drv = _token(client, drv)
            t_pax = _token(client, pax)
            t_out = _token(client, outsider)
            url = "/api/v1/stream/trips/" + trip_id

            # 1. hub introspection is a normal authenticated GET
            stats = client.get("/api/v1/stream/stats", headers=_h(t_pax))
            assert stats.status_code == 200
            assert "pushed" in stats.json()["hub"]

            # 2. no token -> 4401 (handshake rejected before accept)
            with pytest.raises(WebSocketDisconnect) as e1:
                with client.websocket_connect(url) as ws:
                    ws.receive_json()
            assert e1.value.code == 4401

            # 3. non-party -> 4403 (audience gate, no new visibility)
            with pytest.raises(WebSocketDisconnect) as e3:
                with client.websocket_connect(url + "?token=" + t_out) as ws:
                    ws.receive_json()
            assert e3.value.code == 4403

            # 4. driver + booked passenger: hello, then a real push (no polling)
            with client.websocket_connect(url + "?token=" + t_drv) as ws_drv:
                hello = ws_drv.receive_json()
                assert hello["type"] == "hello"
                assert hello["is_driver"] is True
                assert hello["watchers"] == 1
                assert hello["fix"] is None          # nothing shared yet

                with client.websocket_connect(url + "?token=" + t_pax) as ws_pax:
                    hello_p = ws_pax.receive_json()
                    assert hello_p["is_driver"] is False
                    assert hello_p["watchers"] == 2

                    # driver pings over the SOCKET (no HTTP at all)
                    ws_drv.send_json({"type": "ping", "lng": 77.62, "lat": 13.0,
                                      "speed_kmph": 34.5})
                    ack = _next_of_type(ws_drv, "ack")
                    stats_after = client.get("/api/v1/stream/stats",
                                            headers=_h(t_drv)).json()
                    assert stats_after["hub"]["pushed"] >= 2   # both sockets
                    assert stats_after["hub"]["dropped"] == 0
                    assert ack["trip_status"] == "ongoing"   # auto-started
                    assert ack["started"] is True
                    assert ack["pushed_to"] >= 1

                    # the passenger receives the fix by PUSH, not by polling
                    fix = _next_of_type(ws_pax, "fix")
                    assert fix["fix"]["lng"] == 77.62
                    assert fix["fix"]["speed_kmph"] == 34.5
                    assert fix["progress"]["frac"] > 0
                    assert fix["trip_status"] == "ongoing"
                    assert isinstance(fix["fix"]["recorded_at"], str)  # JSON-safe

                    # 5. a ping that is BOTH over-speed (140 > 80) and ~637 m
                    #    off-route raises two alerts, each pushed immediately
                    ws_drv.send_json({"type": "ping", "lng": 77.63, "lat": 12.99,
                                      "speed_kmph": 140.0})
                    ack2 = _next_of_type(ws_drv, "ack")   # drain THIS ping's ack
                    assert len(ack2["alerts"]) == 2
                    pushed = [_next_of_type(ws_pax, "alert")["alert"]]
                    pushed.append(_next_of_type(ws_pax, "alert")["alert"])
                    kinds = sorted(a["type"] for a in pushed)
                    assert kinds == ["deviation", "speed"]
                    speed_alert = [a for a in pushed if a["type"] == "speed"][0]
                    assert speed_alert["severity"] == "critical"
                    assert speed_alert["details"]["limit_kmph"] == 80.0

                    # 5b. repeating the SAME violation is deduped by Module 18:
                    #     no NEW alerts, though the fix itself is still stored
                    ws_drv.send_json({"type": "ping", "lng": 77.63, "lat": 12.99,
                                      "speed_kmph": 140.0})
                    assert _next_of_type(ws_drv, "ack")["alerts"] == []

                    # 6. bad input answers with an error frame, never a drop
                    ws_drv.send_json({"type": "ping", "lng": 999, "lat": 0})
                    assert "out of range" in \
                        _next_of_type(ws_drv, "error")["detail"]
                    ws_drv.send_json({"type": "nonsense"})
                    assert "unknown type" in \
                        _next_of_type(ws_drv, "error")["detail"]
                    ws_drv.send_json({"type": "sync"})
                    state = _next_of_type(ws_drv, "state")
                    assert state["open_alerts"] == 2

                    # 7. a passenger cannot ping (driver-only write path)
                    ws_pax.send_json({"type": "ping", "lng": 77.6, "lat": 13.0})
                    assert "only the driver" in \
                        _next_of_type(ws_pax, "error")["detail"]

                    # 8. keepalive
                    ws_pax.send_json({"type": "ping_me"})
                    assert _next_of_type(ws_pax, "pong")["type"] == "pong"

        # the socket used the SAME core as HTTP, so storage is identical
        async def _verify():
            db = get_db()
            return {
                "fixes": await db.locations.count_documents(
                    {"trip_id": ObjectId(trip_id)}),
                "status": (await db.trips.find_one(
                    {"_id": ObjectId(trip_id)}))["status"],
                "alerts": await db.safety_alerts.count_documents(
                    {"trip_id": ObjectId(trip_id), "status": "open"}),
            }
        check = asyncio.run(_verify())
        assert check["fixes"] == 3          # only valid pings were stored
        assert check["status"] == "ongoing"
        assert check["alerts"] == 2         # 1 speed + 1 deviation, deduped
    finally:
        _cleanup((drv, pax, outsider))


@pytest.mark.asyncio
async def test_http_ping_still_works_after_refactor():
    """Module 17 regression: the HTTP ping contract is unchanged by M20."""
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    phone = "+919000002009"
    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^StreamTest"}})
    await db.locations.delete_many({"trip_id": {"$exists": True}})

    async with _client() as ac:
        assert (await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234", "full_name": "Http Ping",
            "roles": ["driver", "passenger"]})).status_code == 201
        otp = (await ac.post("/api/v1/auth/otp/request",
               json={"phone": phone})).json()
        await ac.post("/api/v1/auth/otp/verify",
                      json={"phone": phone, "code": otp["dev_code"]})
        tok = (await ac.post("/api/v1/auth/login",
               json={"phone": phone, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me", headers=_h(tok))).json()["id"]

        now = datetime.now(timezone.utc)
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
            "source": {"name": "StreamTest HTTP", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "StreamTest HTTP B",
                            "point": {"type": "Point",
                                      "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0], [77.67, 12.8452]]},
            "distance_km": 30.0, "depart_at": now + timedelta(days=1),
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "created_at": now, "updated_at": now})).inserted_id)

        r = await ac.post("/api/v1/tracking/ping", headers=_h(tok),
                          json={"trip_id": trip_id, "lng": 77.62, "lat": 13.0,
                                "speed_kmph": 30.0})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["started"] is True and body["trip_status"] == "ongoing"
        assert body["pushed_to"] == 0      # nobody watching -> no push
        assert body["alerts"] == []

        live = (await ac.get(f"/api/v1/tracking/live/{trip_id}",
                headers=_h(tok))).json()
        assert live["fix"]["lng"] == 77.62

    await db.users.delete_many({"phone": phone})
    await db.trips.delete_many({"source.name": {"$regex": "^StreamTest"}})
    await db.locations.delete_many({"trip_id": {"$exists": True}})


