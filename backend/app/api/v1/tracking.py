"""Live tracking (Module 17): driver GPS -> passenger & admin live view.

- POST /tracking/{trip_id}/start — driver begins active ride tracking
- POST /tracking/{trip_id}/stop  — driver ends ride & closes tracking
- POST /tracking/ping OR /tracking/{trip_id}/location — driver sends device GPS fix
- GET /tracking/live/{trip_id} OR /tracking/{trip_id}/live — latest fix + progress + ETA
- GET /tracking/trail/{trip_id} OR /tracking/{trip_id}/trail — recent GPS breadcrumb trail
- GET /tracking/admin/active — fleet-wide live monitoring for administrators
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.tracking import is_stale, progress_frac

router = APIRouter(prefix="/tracking", tags=["tracking"])

ACTIVE_BOOKING = ("requested", "accepted", "confirmed")


class PingIn(BaseModel):
    trip_id: Optional[str] = None
    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    speed_kmph: Optional[float] = Field(default=None, ge=0, le=300)
    accuracy_m: Optional[float] = Field(default=None, ge=0)
    heading_deg: Optional[float] = Field(default=None, ge=0, le=360)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str = "trip not found") -> ObjectId:
    if not ObjectId.is_valid(str(v)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(str(v))


async def _trip_or_404(db, trip_id: str) -> Dict:
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    return doc


async def _assert_audience(db, trip: Dict, user: Dict) -> None:
    """Driver of the trip, a passenger holding an active booking on it, or an admin."""
    if str(trip["driver_id"]) == user["id"]:
        return
    if "admin" in user.get("roles", []):
        return
    hit = await db.bookings.find_one({
        "trip_id": trip["_id"], "passenger_id": ObjectId(user["id"]),
        "status": {"$in": list(ACTIVE_BOOKING)}})
    if hit is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "live location is shared with this trip only")


def _progress(trip: Dict, lng: float, lat: float, speed_kmph: Optional[float] = None) -> Dict:
    geom = (trip.get("route_geometry") or {}).get("coordinates")
    if geom and len(geom) >= 2:
        res = progress_frac(geom, lng, lat)
        rem_km = res.get("remaining_km")
        if rem_km is not None:
            spd = speed_kmph if (speed_kmph and speed_kmph > 5.0) else 25.0
            res["eta_min"] = round((rem_km / spd) * 60, 1)
        else:
            res["eta_min"] = None
        return res
    return {"frac": None, "dist_along_km": None, "remaining_km": None,
            "off_route_m": None, "off_route": False, "route_km": None,
            "routed": False, "eta_min": None}


def _live_row(trip: Dict, fix: Optional[Dict]) -> Dict:
    now = _utcnow()
    if fix is None:
        return {"trip_id": str(trip["_id"]), "trip_status": trip["status"],
                "fix": None, "stale": True,
                "message": "driver has not shared location yet"}
    lng, lat = fix["point"]["coordinates"]
    speed = fix.get("speed_kmph")
    row = {"trip_id": str(trip["_id"]), "trip_status": trip["status"],
           "fix": {"lng": lng, "lat": lat,
                   "speed_kmph": speed,
                   "accuracy_m": fix.get("accuracy_m"),
                   "heading_deg": fix.get("heading_deg"),
                   "recorded_at": fix.get("recorded_at")},
           "progress": _progress(trip, lng, lat, speed),
           "stale": is_stale(fix.get("recorded_at"), now)}
    return row


async def record_ping(db, trip: Dict, actor_id: str, lng: float, lat: float,
                      speed_kmph: Optional[float],
                      accuracy_m: Optional[float] = None,
                      heading_deg: Optional[float] = None) -> Dict:
    """THE single write path for a GPS fix (Module 17) — shared by the HTTP
    ping route and the Module 20 WebSocket so both cannot drift.
    """
    now = _utcnow()
    prog = _progress(trip, lng, lat, speed_kmph)
    doc = {
        "trip_id": trip["_id"], "actor_id": ObjectId(actor_id),
        "point": {"type": "Point", "coordinates": [lng, lat]},
        "speed_kmph": speed_kmph, "recorded_at": now
    }
    if accuracy_m is not None:
        doc["accuracy_m"] = accuracy_m
    if heading_deg is not None:
        doc["heading_deg"] = heading_deg

    await db.locations.insert_one(doc)

    from app.api.v1.safety import auto_check
    alerts = await auto_check(db, trip, lng, lat, speed_kmph)

    started = False
    if trip["status"] == "published":
        await db.trips.update_one(
            {"_id": trip["_id"]},
            {"$set": {"status": "ongoing", "started_at": now,
                      "updated_at": now}})
        trip["status"] = "ongoing"
        started = True

    payload = {"ok": True, "trip_status": trip["status"], "started": started,
               "progress": prog, "recorded_at": now, "alerts": alerts}
    fix = {"lng": lng, "lat": lat, "speed_kmph": speed_kmph,
           "accuracy_m": accuracy_m, "heading_deg": heading_deg,
           "recorded_at": now}
    from app.services.hub import hub
    payload["pushed_to"] = await hub.broadcast(
        str(trip["_id"]),
        {"type": "fix", "trip_id": str(trip["_id"]), "fix": fix,
         "progress": prog, "trip_status": trip["status"]})
    for a in alerts:
        await hub.broadcast(str(trip["_id"]),
                            {"type": "alert", "trip_id": str(trip["_id"]),
                             "alert": a})
    return payload


@router.post("/ping")
async def ping(body: PingIn, user: Dict = Depends(get_current_user)):
    """Driver heartbeat: validate -> delegate to the shared ping core."""
    if not body.trip_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "trip_id required")
    db = get_db()
    trip = await _trip_or_404(db, body.trip_id)
    if str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "only the driver shares live location")
    if trip["status"] not in ("published", "ongoing"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip is " + str(trip.get("status")) + " — no tracking")
    return await record_ping(db, trip, user["id"], body.lng, body.lat,
                             body.speed_kmph, body.accuracy_m, body.heading_deg)


@router.post("/{trip_id}/location")
async def location_update(trip_id: str, body: PingIn, user: Dict = Depends(get_current_user)):
    """Driver location update via trip_id route parameter."""
    db = get_db()
    trip = await _trip_or_404(db, trip_id)
    if str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "only the driver shares live location")
    if trip["status"] not in ("published", "ongoing"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip is " + str(trip.get("status")) + " — no tracking")
    return await record_ping(db, trip, user["id"], body.lng, body.lat,
                             body.speed_kmph, body.accuracy_m, body.heading_deg)


@router.post("/{trip_id}/start")
async def start_tracking(trip_id: str, user: Dict = Depends(get_current_user)):
    """Driver starts tracking: transitions published -> ongoing and alerts watchers."""
    db = get_db()
    trip = await _trip_or_404(db, trip_id)
    if str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "only the driver of this trip can start tracking")
    if trip["status"] not in ("published", "ongoing"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip is " + str(trip.get("status")) + " — cannot start tracking")

    now = _utcnow()
    if trip["status"] == "published":
        await db.trips.update_one(
            {"_id": trip["_id"]},
            {"$set": {"status": "ongoing", "started_at": now, "updated_at": now}})
        trip["status"] = "ongoing"

    from app.services.hub import hub
    await hub.broadcast(str(trip["_id"]), {
        "type": "state", "trip_id": str(trip["_id"]),
        "trip_status": trip["status"], "started": True
    })

    return {
        "ok": True,
        "trip_id": str(trip["_id"]),
        "status": trip["status"],
        "message": "Tracking started successfully. Continuous GPS active."
    }


@router.post("/{trip_id}/stop")
async def stop_tracking(trip_id: str, user: Dict = Depends(get_current_user)):
    """Driver ends ride and stops tracking: completes trip and resolves bookings."""
    db = get_db()
    trip = await _trip_or_404(db, trip_id)
    if str(trip["driver_id"]) != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "only the driver or admin can stop tracking")
    if trip["status"] in ("completed", "cancelled", "rejected"):
        return {"ok": True, "trip_id": str(trip["_id"]), "status": trip["status"],
                "message": "Trip already stopped"}

    now = _utcnow()
    from app.api.v1.segments import persist_segments
    from app.services.lifecycle import resolve_completion

    try:
        await persist_segments(db, trip)
    except Exception:
        pass

    open_docs = await db.bookings.find({
        "trip_id": trip["_id"],
        "status": {"$in": ["requested", "accepted", "confirmed"]}}).to_list(200)
    plan = resolve_completion(open_docs)
    for t in plan["transitions"]:
        await db.bookings.update_one(
            {"_id": ObjectId(t["id"]), "status": t["from"]},
            {"$set": {"status": t["to"], "closed_at": now, "updated_at": now,
                      **({"closure_note": t["note"]} if t.get("note") else {})}})

    await db.trips.update_one(
        {"_id": trip["_id"]},
        {"$set": {"status": "completed", "completed_at": now, "updated_at": now}}
    )
    trip["status"] = "completed"

    from app.services.hub import hub
    await hub.broadcast(str(trip["_id"]), {
        "type": "state", "trip_id": str(trip["_id"]),
        "trip_status": "completed", "stopped": True
    })

    return {
        "ok": True,
        "trip_id": str(trip["_id"]),
        "status": "completed",
        "message": "Tracking stopped and ride completed successfully."
    }


@router.get("/live/{trip_id}")
async def live(trip_id: str, user: Dict = Depends(get_current_user)):
    """Latest fix + progress for the trip audience (driver + active riders + admin)."""
    db = get_db()
    trip = await _trip_or_404(db, trip_id)
    await _assert_audience(db, trip, user)
    fix = await db.locations.find_one(
        {"trip_id": trip["_id"]}, sort=[("recorded_at", -1)])
    return _live_row(trip, fix)


@router.get("/trail/{trip_id}")
async def trail(trip_id: str, user: Dict = Depends(get_current_user),
                limit: int = Query(default=100, ge=1, le=200)):
    """Recent fixes (newest first) for the map polyline — same audience."""
    db = get_db()
    trip = await _trip_or_404(db, trip_id)
    await _assert_audience(db, trip, user)
    cur = db.locations.find({"trip_id": trip["_id"]}).sort(
        "recorded_at", -1).limit(limit)
    fixes = [{"lng": d["point"]["coordinates"][0],
              "lat": d["point"]["coordinates"][1],
              "speed_kmph": d.get("speed_kmph"),
              "accuracy_m": d.get("accuracy_m"),
              "heading_deg": d.get("heading_deg"),
              "recorded_at": d.get("recorded_at")} async for d in cur]
    return {"trip_id": str(trip["_id"]), "trip_status": trip["status"],
            "count": len(fixes), "fixes": fixes}


