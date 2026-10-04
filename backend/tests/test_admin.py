"""Module 21 tests: moderation rules (pure) + admin console (live)."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.moderation import action_guard, dashboard, sort_alerts


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


ADMIN = {"id": "a1", "roles": ["admin", "driver"]}
TARGET = {"_id": "u1", "roles": ["passenger"], "status": "active"}


def test_action_guard_blocks_self_and_last_admin():
    # nobody without the admin role may moderate
    ok = action_guard({"id": "x", "roles": ["driver"]}, TARGET, "suspend")
    assert ok["allowed"] is False and "admin role" in ok["reason"]
    # self-service lockout protection
    mine = {"_id": "a1", "roles": ["admin"], "status": "active"}
    self_sus = action_guard(ADMIN, mine, "suspend")
    assert self_sus["allowed"] is False and "your own account" in self_sus["reason"]
    self_role = action_guard(ADMIN, mine, "role_remove", role="admin",
                             admin_count=3)
    assert self_role["allowed"] is False
    # the last admin is protected even from another admin
    other_admin = {"_id": "a2", "roles": ["admin"], "status": "active"}
    last = action_guard(ADMIN, other_admin, "suspend", admin_count=1)
    assert last["allowed"] is False and "last admin" in last["reason"]
    # ...but with a second admin around, removal is legitimate
    assert action_guard(ADMIN, other_admin, "suspend", admin_count=2)["allowed"]


def test_action_guard_lifecycle_and_roles():
    assert action_guard(ADMIN, TARGET, "suspend")["allowed"] is True
    suspended = {"_id": "u2", "roles": ["passenger"], "status": "suspended"}
    assert "already suspended" in action_guard(ADMIN, suspended, "suspend")["reason"]
    assert action_guard(ADMIN, suspended, "reactivate")["allowed"] is True
    assert "already active" in action_guard(ADMIN, TARGET, "reactivate")["reason"]

    assert "already holds" in action_guard(
        ADMIN, TARGET, "role_add", role="passenger")["reason"]
    assert action_guard(ADMIN, TARGET, "role_add", role="driver")["allowed"] is True
    assert "does not hold" in action_guard(
        ADMIN, TARGET, "role_remove", role="driver")["reason"]
    lone = {"_id": "u3", "roles": ["passenger"], "status": "active"}
    assert "strand" in action_guard(
        ADMIN, lone, "role_remove", role="passenger")["reason"]
    assert "role must be" in action_guard(
        ADMIN, TARGET, "role_add", role="pilot")["reason"]
    assert "unknown action" in action_guard(ADMIN, TARGET, "explode")["reason"]


def test_sort_alerts_orders_the_queue():
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    docs = [
        {"status": "resolved", "severity": "critical",
         "created_at": now - timedelta(hours=1)},
        {"status": "open", "severity": "low", "created_at": now},
        {"status": "acknowledged", "severity": "critical", "created_at": now},
        {"status": "open", "severity": "critical",
         "created_at": now - timedelta(minutes=5)},
    ]
    order = [(a["status"], a["severity"]) for a in sort_alerts(docs)]
    assert order == [("open", "critical"), ("open", "low"),
                     ("acknowledged", "critical"), ("resolved", "critical")]


def test_dashboard_derives_metrics():
    d = dashboard(
        {"total": 8, "active": 6, "suspended": 2, "drivers": 4,
         "passengers": 7, "admins": 2, "phone_verified": 4},
        {"total": 5, "by_status": {"ongoing": 1, "completed": 3, "cancelled": 1}},
        {"total": 9, "by_status": {"confirmed": 2, "completed": 4,
                                   "rejected": 3}},
        {"total": 6, "open": 4,
         "by_severity": {"critical": 2, "high": 1, "medium": 1, "low": 0}},
        locations=120, vehicles={"total": 3, "pending": 1, "verified": 2,
                                 "rejected": 0})
    assert d["users"]["verified_pct"] == 50.0
    assert d["trips"]["live"] == 1 and d["trips"]["completion_rate_pct"] == 75.0
    assert d["bookings"]["settled_seats"] == 6
    assert d["alerts"]["critical_open"] == 2 and d["alerts"]["open"] == 4
    assert d["vehicles"]["pending"] == 1 and d["locations"] == 120
    empty = dashboard({}, {}, {}, {})
    assert empty["users"]["verified_pct"] == 0.0
    assert empty["trips"]["completion_rate_pct"] == 0.0


@pytest.mark.asyncio
async def test_admin_console_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    adm, usr, other = "+919000002101", "+919000002102", "+919000002103"
    for p in (adm, usr, other):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^AdminTest"}})
    await db.safety_alerts.delete_many({})

    async with _client() as ac:
        for p in (adm, usr, other):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Admin " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        # the ONLY route to admin is a direct DB promotion (Module 3 rule)
        await db.users.update_one({"phone": adm}, {"$set": {"roles": ["admin"]}})
        t_adm = (await ac.post("/api/v1/auth/login",
                 json={"phone": adm, "password": "pass1234"})).json()["access_token"]
        t_usr = (await ac.post("/api/v1/auth/login",
                 json={"phone": usr, "password": "pass1234"})).json()["access_token"]
        t_other = (await ac.post("/api/v1/auth/login",
                   json={"phone": other, "password": "pass1234"})).json()["access_token"]
        uid_usr = (await ac.get("/api/v1/auth/me",
                   headers=_h(t_usr))).json()["id"]
        uid_other = (await ac.get("/api/v1/auth/me",
                     headers=_h(t_other))).json()["id"]

        now = datetime.now(timezone.utc)
        trip_id = (await db.trips.insert_one({
            "driver_id": ObjectId(uid_usr), "vehicle_id": ObjectId(),
            "source": {"name": "AdminTest A", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "AdminTest B", "point": {"type": "Point",
                             "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0], [77.67, 12.8452]]},
            "distance_km": 30.0, "depart_at": now + timedelta(days=1),
            "seats_offered": 3, "seats_booked": 0, "status": "ongoing",
            "created_at": now, "updated_at": now})).inserted_id
        alert_id = (await db.safety_alerts.insert_one({
            "trip_id": trip_id, "booking_id": None, "type": "sos",
            "severity": "critical", "point": None,
            "details": {"message": "help"}, "status": "open",
            "created_at": now, "resolved_at": None})).inserted_id

        # 1. non-admins are locked out of every console route
        for path in ("/api/v1/admin/stats", "/api/v1/admin/users",
                     "/api/v1/admin/trips", "/api/v1/admin/alerts"):
            assert (await ac.get(path, headers=_h(t_usr))).status_code == 403
        assert (await ac.post("/api/v1/admin/alerts/{}/resolve".format(alert_id),
                headers=_h(t_usr))).status_code == 403
        assert (await ac.get("/api/v1/admin/stats")).status_code in (401, 403)

        # 2. dashboard cards + derived metrics + stream introspection
        s = (await ac.get("/api/v1/admin/stats", headers=_h(t_adm))).json()
        assert s["users"]["total"] >= 3 and s["users"]["admins"] >= 1
        assert s["trips"]["live"] >= 1
        assert s["alerts"]["open"] >= 1 and s["alerts"]["critical_open"] >= 1
        assert isinstance(s["users"]["verified_pct"], float)
        assert "scope" in s["stream"]
        assert s["generated_at"] is not None

        # 3. user browser: search + filters + validation
        found = (await ac.get("/api/v1/admin/users?q=" + usr[-4:],
                 headers=_h(t_adm))).json()
        assert found["total"] == 1 and found["users"][0]["phone"] == usr
        assert (await ac.get("/api/v1/admin/users?status=suspended",
                headers=_h(t_adm))).json()["count"] == 0
        assert (await ac.get("/api/v1/admin/users?status=weird",
                headers=_h(t_adm))).status_code == 422
        assert (await ac.get("/api/v1/admin/users?role=pilot",
                headers=_h(t_adm))).status_code == 422
        assert (await ac.get("/api/v1/admin/users?role=admin",
                headers=_h(t_adm))).json()["total"] >= 1

        # 4. self-moderation blocked even for a legit admin
        adm_id = (await ac.get("/api/v1/auth/me",
                  headers=_h(t_adm))).json()["id"]
        r = await ac.post("/api/v1/admin/users/{}/suspend".format(adm_id),
                          headers=_h(t_adm))
        assert r.status_code == 422 and "your own account" in r.json()["detail"]

        # 5. suspend kills the target's LIVE token immediately
        r = await ac.post("/api/v1/admin/users/{}/suspend".format(uid_usr),
                          headers=_h(t_adm))
        assert r.status_code == 200 and r.json()["user"]["status"] == "suspended"
        blocked = await ac.get("/api/v1/users/me", headers=_h(t_usr))
        assert blocked.status_code == 403
        assert "suspended" in blocked.json()["detail"]
        assert (await ac.post("/api/v1/auth/login", json={
            "phone": usr, "password": "pass1234"})).status_code == 403
        # double suspend / valid reactivate
        assert (await ac.post("/api/v1/admin/users/{}/suspend".format(uid_usr),
                headers=_h(t_adm))).status_code == 422
        assert (await ac.post("/api/v1/admin/users/{}/reactivate".format(uid_usr),
                headers=_h(t_adm))).status_code == 200
        assert (await ac.get("/api/v1/users/me",
                headers=_h(t_usr))).status_code == 200

        # 6. role management: remove, last-role guard, add, duplicate, bad role
        #    (all three users registered with driver+passenger)
        r = await ac.post("/api/v1/admin/users/{}/roles".format(uid_other),
                          headers=_h(t_adm),
                          json={"role": "driver", "action": "remove"})
        assert r.status_code == 200 and "driver" not in r.json()["user"]["roles"]
        # now only passenger remains: removing it would strand the account
        r = await ac.post("/api/v1/admin/users/{}/roles".format(uid_other),
                          headers=_h(t_adm),
                          json={"role": "passenger", "action": "remove"})
        assert r.status_code == 422 and "strand" in r.json()["detail"]
        r = await ac.post("/api/v1/admin/users/{}/roles".format(uid_other),
                          headers=_h(t_adm),
                          json={"role": "driver", "action": "add"})
        assert r.status_code == 200 and "driver" in r.json()["user"]["roles"]
        assert (await ac.post("/api/v1/admin/users/{}/roles".format(uid_other),
                headers=_h(t_adm),
                json={"role": "driver", "action": "add"})).status_code == 422
        assert (await ac.post("/api/v1/admin/users/{}/roles".format(uid_other),
                headers=_h(t_adm),
                json={"role": "pilot", "action": "add"})).status_code == 422

        # 7. trip board shows the live trip with driver name + alert count
        board = (await ac.get("/api/v1/admin/trips?live_only=true",
                 headers=_h(t_adm))).json()
        row = [t for t in board["trips"] if t["id"] == str(trip_id)][0]
        assert row["status"] == "ongoing" and row["open_alerts"] == 1
        assert row["driver_name"] == "Admin " + usr[-3:]
        assert (await ac.get("/api/v1/admin/trips?status=weird",
                headers=_h(t_adm))).status_code == 422

        # 8. alert queue ordering + resolution lifecycle
        q = (await ac.get("/api/v1/admin/alerts?status=all",
               headers=_h(t_adm))).json()
        assert q["alerts"][0]["id"] == str(alert_id)
        assert q["alerts"][0]["source_name"] == "AdminTest A"
        assert (await ac.get("/api/v1/admin/alerts?severity=weird",
                headers=_h(t_adm))).status_code == 422
        r = await ac.post("/api/v1/admin/alerts/{}/resolve".format(alert_id),
                          headers=_h(t_adm))
        assert r.status_code == 200 and r.json()["alert"]["status"] == "resolved"
        assert r.json()["alert"]["resolved_at"] is not None
        # double resolve is a real mistake, not a silent no-op
        assert (await ac.post("/api/v1/admin/alerts/{}/resolve".format(alert_id),
                headers=_h(t_adm))).status_code == 422

    for p in (adm, usr, other):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^AdminTest"}})
    await db.safety_alerts.delete_many({})


