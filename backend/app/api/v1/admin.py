"""Admin console (Module 21): the operations side of the platform.

Everything here is `require_roles("admin")` — the only path to that role is a
direct DB promotion (Module 3 refuses self-registering as admin), which is
exactly what an MCA demo wants: no hidden privilege escalation route.

- GET  /admin/stats            dashboard cards (derived metrics via services/moderation)
- GET  /admin/users            search + filter the user base
- POST /admin/users/{id}/suspend      account lock (live JWTs die immediately:
                                      core.deps re-checks status every request)
- POST /admin/users/{id}/reactivate   undo a suspension
- POST /admin/users/{id}/roles        add/remove driver|passenger|admin
- GET  /admin/trips            cross-driver trip board
- GET  /admin/alerts           moderation queue (open + critical first)
- POST /admin/alerts/{id}/resolve     close an alert (Module 18 left this open)

Vehicle verification lives in Module 5 (`/vehicles/admin/*`) and is linked from
the console rather than duplicated.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_db
from app.core.deps import require_roles
from app.services.hub import hub
from app.services.moderation import (
    ASSIGNABLE_ROLES,
    action_guard,
    dashboard,
    sort_alerts,
)

router = APIRouter(prefix="/admin", tags=["admin"])
_admin = require_roles("admin")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(str(v)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(str(v))


def _user_row(doc: Dict) -> Dict:
    return {
        "id": str(doc["_id"]),
        "phone": doc.get("phone"),
        "full_name": doc.get("full_name"),
        "roles": doc.get("roles", []),
        "phone_verified": bool(doc.get("phone_verified", False)),
        "status": doc.get("status", "active"),
        "rating_avg": doc.get("rating_avg"),
        "rating_count": int(doc.get("rating_count", 0)),
        "created_at": doc.get("created_at"),
    }


def _alert_row(doc: Dict) -> Dict:
    return {
        "id": str(doc["_id"]),
        "trip_id": str(doc["trip_id"]),
        "type": doc.get("type"),
        "severity": doc.get("severity"),
        "status": doc.get("status"),
        "point": doc.get("point"),
        "details": doc.get("details"),
        "created_at": doc.get("created_at"),
        "resolved_at": doc.get("resolved_at"),
    }


class RoleChangeIn(BaseModel):
    role: str
    action: str = Field(default="add")

    @field_validator("role")
    @classmethod
    def role_known(cls, v: str) -> str:
        if v not in ASSIGNABLE_ROLES:
            raise ValueError("role must be " + "|".join(ASSIGNABLE_ROLES))
        return v

    @field_validator("action")
    @classmethod
    def action_known(cls, v: str) -> str:
        if v not in ("add", "remove"):
            raise ValueError("action must be add|remove")
        return v


async def _target_user(db, user_id: str) -> Dict:
    doc = await db.users.find_one({"_id": _oid(user_id, "user not found")})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return doc


async def _admin_count(db) -> int:
    return await db.users.count_documents({"roles": "admin",
                                           "status": "active"})


@router.get("/stats")
async def admin_stats(user: Dict = Depends(_admin)):
    """Dashboard cards. Counts are cheap; derived metrics come from the pure
    `dashboard()` helper so the console and the report never disagree."""
    _ = user
    db = get_db()
    users_total = await db.users.count_documents({})
    users = {
        "total": users_total,
        "active": await db.users.count_documents({"status": "active"}),
        "suspended": await db.users.count_documents({"status": "suspended"}),
        "drivers": await db.users.count_documents({"roles": "driver"}),
        "passengers": await db.users.count_documents({"roles": "passenger"}),
        "admins": await db.users.count_documents({"roles": "admin"}),
        "phone_verified": await db.users.count_documents({"phone_verified": True}),
    }
    trips_by_status = {}
    for st in ("draft", "published", "ongoing", "completed", "cancelled"):
        trips_by_status[st] = await db.trips.count_documents({"status": st})
    trips = {"total": await db.trips.count_documents({}),
             "by_status": trips_by_status}
    bookings_by_status = {}
    for st in ("requested", "accepted", "confirmed", "rejected", "cancelled",
               "completed"):
        bookings_by_status[st] = await db.bookings.count_documents({"status": st})
    bookings = {"total": await db.bookings.count_documents({}),
                "by_status": bookings_by_status}
    alerts_by_severity = {}
    for sev in ("critical", "high", "medium", "low"):
        alerts_by_severity[sev] = await db.safety_alerts.count_documents(
            {"severity": sev, "status": "open"})
    alerts = {"total": await db.safety_alerts.count_documents({}),
              "open": await db.safety_alerts.count_documents({"status": "open"}),
              "by_severity": alerts_by_severity}
    vehicles = {
        "total": await db.vehicles.count_documents({}),
        "pending": await db.vehicles.count_documents(
            {"verification_status": "pending", "is_active": True}),
        "verified": await db.vehicles.count_documents(
            {"verification_status": "verified"}),
        "rejected": await db.vehicles.count_documents(
            {"verification_status": "rejected"}),
    }
    out = dashboard(users, trips, bookings, alerts,
                    locations=await db.locations.count_documents({}),
                    vehicles=vehicles)
    out["stream"] = hub.stats()
    out["generated_at"] = _utcnow()
    return out


@router.get("/users")
async def admin_users(
    q: str = Query(default="", max_length=80),
    status_: str = Query(default="", alias="status"),
    role: str = Query(default=""),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: Dict = Depends(_admin),
):
    """User base browser: substring search on name/phone, plus filters."""
    _ = user
    db = get_db()
    query: Dict = {}
    if q:
        query["$or"] = [{"full_name": {"$regex": q, "$options": "i"}},
                        {"phone": {"$regex": q}}]
    if status_:
        if status_ not in ("active", "suspended", "deleted"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "bad status filter")
        query["status"] = status_
    if role:
        if role not in ASSIGNABLE_ROLES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "bad role filter")
        query["roles"] = role
    total = await db.users.count_documents(query)
    cur = (db.users.find(query).sort("created_at", -1)
           .skip(offset).limit(limit))
    rows = [_user_row(d) async for d in cur]
    return {"total": total, "count": len(rows), "offset": offset,
            "limit": limit, "users": rows}


@router.post("/users/{user_id}/suspend")
async def suspend_user(user_id: str, user: Dict = Depends(_admin)):
    """Account lock. Live JWTs stop working immediately because
    core.deps.get_current_user re-reads status on every request."""
    db = get_db()
    target = await _target_user(db, user_id)
    guard = action_guard(user, target, "suspend",
                        admin_count=await _admin_count(db))
    if not guard["allowed"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, guard["reason"])
    updated = await db.users.find_one_and_update(
        {"_id": target["_id"], "status": "active"},
        {"$set": {"status": "suspended", "suspended_at": _utcnow(),
                  "updated_at": _utcnow()}}, return_document=True)
    if updated is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "account changed state")
    return {"suspended": True, "user": _user_row(updated)}


@router.post("/users/{user_id}/reactivate")
async def reactivate_user(user_id: str, user: Dict = Depends(_admin)):
    db = get_db()
    target = await _target_user(db, user_id)
    guard = action_guard(user, target, "reactivate")
    if not guard["allowed"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, guard["reason"])
    updated = await db.users.find_one_and_update(
        {"_id": target["_id"], "status": "suspended"},
        {"$set": {"status": "active", "updated_at": _utcnow()}},
        return_document=True)
    if updated is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "account changed state")
    return {"reactivated": True, "user": _user_row(updated)}


@router.post("/users/{user_id}/roles")
async def change_user_roles(user_id: str, body: RoleChangeIn,
                            user: Dict = Depends(_admin)):
    """Role add/remove — the admin-only path Modules 4/5 deferred here."""
    db = get_db()
    target = await _target_user(db, user_id)
    action = "role_add" if body.action == "add" else "role_remove"
    guard = action_guard(user, target, action, role=body.role,
                        admin_count=await _admin_count(db))
    if not guard["allowed"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, guard["reason"])
    op = ("$addToSet" if body.action == "add" else "$pull")
    updated = await db.users.find_one_and_update(
        {"_id": target["_id"]},
        {op: {"roles": body.role}, "$set": {"updated_at": _utcnow()}},
        return_document=True)
    return {"changed": True, "action": body.action, "role": body.role,
            "user": _user_row(updated)}


@router.get("/trips")
async def admin_trips(
    status_: str = Query(default="", alias="status"),
    live_only: bool = Query(default=False),
    limit: int = Query(default=25, ge=1, le=100),
    user: Dict = Depends(_admin),
):
    """Cross-driver trip board: what is live, what sold, who is driving."""
    _ = user
    db = get_db()
    query: Dict = {}
    if live_only:
        query["status"] = "ongoing"
    elif status_:
        if status_ not in ("draft", "published", "ongoing", "completed",
                           "cancelled"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "bad status filter")
        query["status"] = status_
    cur = db.trips.find(query).sort("depart_at", -1).limit(limit)
    rows: List[Dict] = []
    async for doc in cur:
        driver = await db.users.find_one({"_id": doc["driver_id"]},
                                         {"full_name": 1, "phone": 1})
        latest = await db.locations.find_one({"trip_id": doc["_id"]},
                                             sort=[("recorded_at", -1)])
        rows.append({
            "id": str(doc["_id"]),
            "source_name": doc["source"]["name"],
            "destination_name": doc["destination"]["name"],
            "depart_at": doc.get("depart_at"),
            "status": doc.get("status"),
            "seats_offered": doc.get("seats_offered"),
            "seats_booked": doc.get("seats_booked", 0),
            "driver_name": (driver or {}).get("full_name"),
            "driver_id": str(doc["driver_id"]),
            "tracked": latest is not None,
            "open_alerts": await db.safety_alerts.count_documents(
                {"trip_id": doc["_id"], "status": "open"}),
            "recurring": doc.get("recurring_group_id") is not None,
        })
    return {"count": len(rows), "trips": rows}


@router.get("/alerts")
async def admin_alerts(
    status_: str = Query(default="open", alias="status"),
    severity: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
    user: Dict = Depends(_admin),
):
    """Moderation queue: open + critical first (services/moderation.sort_alerts)."""
    _ = user
    db = get_db()
    query: Dict = {}
    if status_:
        if status_ not in ("open", "acknowledged", "resolved", "all"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "bad status filter")
        if status_ != "all":
            query["status"] = status_
    if severity:
        if severity not in ("low", "medium", "high", "critical"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "bad severity filter")
        query["severity"] = severity
    docs = await db.safety_alerts.find(query).limit(limit).to_list(limit)
    ordered = sort_alerts(docs)
    rows = []
    for a in ordered:
        row = _alert_row(a)
        trip = await db.trips.find_one({"_id": a["trip_id"]},
                                       {"source.name": 1, "destination.name": 1,
                                        "driver_id": 1})
        if trip:
            row["source_name"] = trip["source"]["name"]
            row["destination_name"] = trip["destination"]["name"]
            driver = await db.users.find_one({"_id": trip["driver_id"]},
                                             {"full_name": 1})
            row["driver_name"] = (driver or {}).get("full_name")
        rows.append(row)
    return {"count": len(rows), "alerts": rows}


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, user: Dict = Depends(_admin)):
    """Close an alert. Module 18 owned create/acknowledge; resolution is the
    admin's call, and it is recorded with who did it."""
    db = get_db()
    alert = await db.safety_alerts.find_one(
        {"_id": _oid(alert_id, "alert not found")})
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found")
    if alert.get("status") == "resolved":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "alert is already resolved")
    updated = await db.safety_alerts.find_one_and_update(
        {"_id": alert["_id"], "status": {"$ne": "resolved"}},
        {"$set": {"status": "resolved", "resolved_at": _utcnow(),
                  "resolved_by": user["id"]}}, return_document=True)
    if updated is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "alert changed state")
    return {"resolved": True, "alert": _alert_row(updated)}



