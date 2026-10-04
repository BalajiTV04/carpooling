"""Live tracking (Module 17): driver pings -> passenger live view.

- POST /tracking/ping {trip_id, lng, lat, speed_kmph?} — DRIVER of that trip
  only (403 otherwise). Validates coords + sane speed, projects onto the trip
  route (same ruler as M9/M10/M13), stores a `locations` doc (TTL 30d), and
  auto-flips published -> ongoing on first ping.
- GET /tracking/live/{trip_id} — driver + passengers with an ACTIVE booking
  (requested/accepted/confirmed) on the trip. Returns latest fix + progress
  frac + remaining km + off-route/stale flags.
- GET /tracking/trail/{trip_id} — same audience, last ≤100 fixes (newest
  first) for the map polyline.

Privacy: no history beyond the trip audience; locations expire via the M2 TTL
index. Safety (M18) reads the same `locations` collection — no new storage.
"""
from datetime import datetime, timezone
from typing import Dict, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.tracking import is_stale, progress_frac

router = APIRouter(prefix="/tracking", tags=["tracking"])

ACTIVE_BOOKING = ("requested", "accepted", "confirmed")


class PingIn(BaseModel):
    trip_id: str
    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    speed_kmph: Optional[float] = Field(default=None, ge=0, le=300)


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
    """Driver of the trip, or a passenger holding an active booking on it."""
    if str(trip["driver_id"]) == user["id"]:
        return
    hit = await db.bookings.find_one({
        "trip_id": trip["_id"], "passenger_id": ObjectId(user["id"]),
        "status": {"$in": list(ACTIVE_BOOKING)}})
    if hit is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "live location is shared with this trip only")


def _progress(trip: Dict, lng: float, lat: float) -> Dict:
    geom = (trip.get("route_geometry") or {}).get("coordinates")
    if geom and len(geom) >= 2:
        return progress_frac(geom, lng, lat)
    return {"frac": None, "dist_along_km": None, "remaining_km": None,
            "off_route_m": None, "off_route": False, "route_km": None,
            "routed": False}


def _live_row(trip: Dict, fix: Optional[Dict]) -> Dict:
    now = _utcnow()
    if fix is None:
        return {"trip_id": str(trip["_id"]), "trip_status": trip["status"],
                "fix": None, "stale": True,
                "message": "driver has not shared location yet"}
    lng, lat = fix["point"]["coordinates"]
    row = {"trip_id": str(trip["_id"]), "trip_status": trip["status"],
           "fix": {"lng": lng, "lat": lat,
                   "speed_kmph": fix.get("speed_kmph"),
                   "recorded_at": fix.get("recorded_at")},
           "progress": _progress(trip, lng, lat),
           "stale": is_stale(fix.get("recorded_at"), now)}
    return row


async def record_ping(db, trip: Dict, actor_id: str, lng: float, lat: float,
                      speed_kmph: Optional[float]) -> Dict:
    """THE single write path for a GPS fix (Module 17) — shared by the HTTP
    ping route and the Module 20 WebSocket so both cannot drift.

    Callers own authorisation (driver-only) and trip-status checks; this
    function stores the fix, runs the Module 18 auto-detectors, flips
    published -> ongoing on the first fix, and broadcasts to live watchers.
    Mutates `trip["status"]` so callers see the post-ping state.
    """
    now = _utcnow()
    prog = _progress(trip, lng, lat)
    await db.locations.insert_one({
        "trip_id": trip["_id"], "actor_id": ObjectId(actor_id),
        "point": {"type": "Point", "coordinates": [lng, lat]},
        "speed_kmph": speed_kmph, "recorded_at": now})

    from app.api.v1.safety import auto_check  # lazy: avoids a router cycle
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
    # Module 20: push to watchers NOW (the heartbeat is only a safety net).
    fix = {"lng": lng, "lat": lat, "speed_kmph": speed_kmph,
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
    db = get_db()
    trip = await _trip_or_404(db, body.trip_id)
    if str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "only the driver shares live location")
    if trip["status"] not in ("published", "ongoing"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip is " + str(trip.get("status")) + " — no tracking")
    # Module 20: the same core the WebSocket uses (one write path, one
    # broadcast). `pushed_to` tells the driver how many live watchers saw it.
    return await record_ping(db, trip, user["id"], body.lng, body.lat,
                             body.speed_kmph)


@router.get("/live/{trip_id}")
async def live(trip_id: str, user: Dict = Depends(get_current_user)):
    """Latest fix + progress for the trip audience (driver + active riders)."""
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
              "recorded_at": d.get("recorded_at")} async for d in cur]
    return {"trip_id": str(trip["_id"]), "trip_status": trip["status"],
            "count": len(fixes), "fixes": fixes}

