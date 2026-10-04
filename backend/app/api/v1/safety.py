"""Safety net (Module 18): SOS + auto speed/deviation alerts + acknowledge.

- POST /safety/sos {trip_id, booking_id?, message?} — any ACTIVE trip party
  (driver or booked passenger): creates a CRITICAL sos alert, always (SOS is
  never deduped — every press is a cry for help).
- GET /safety/trip/{trip_id} — trip audience (same gate as tracking live):
  open + recent alerts for the banner.
- POST /safety/{alert_id}/ack — driver of the trip or admin: open ->
  acknowledged. (Resolve comes in the admin module; passengers see status.)
- AUTO (no endpoint): every tracking ping runs the speed + deviation verdicts
  and inserts at most one OPEN alert per (trip, type) — no spam at 10s cadence.

Reads the Module 17 `locations` stream; writes `safety_alerts` (M2 schema, no
migration). Severity ladder: speed +0-20 medium / +20-40 high / +40 critical;
deviation high; SOS critical.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.v1.tracking import _assert_audience, _trip_or_404
from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.safety import deviation_verdict, speed_verdict

router = APIRouter(prefix="/safety", tags=["safety"])

ACTIVE_BOOKING = ("requested", "accepted", "confirmed")


class SosIn(BaseModel):
    trip_id: str
    booking_id: Optional[str] = None
    message: Optional[str] = Field(default=None, max_length=500)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str = "not found") -> ObjectId:
    if not ObjectId.is_valid(str(v)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(str(v))


def _out(doc: Dict) -> Dict:
    return {
        "id": str(doc["_id"]),
        "trip_id": str(doc["trip_id"]),
        "booking_id": str(doc["booking_id"]) if doc.get("booking_id") else None,
        "type": doc["type"],
        "severity": doc["severity"],
        "status": doc["status"],
        "point": doc.get("point"),
        "details": doc.get("details"),
        "created_at": doc.get("created_at"),
        "resolved_at": doc.get("resolved_at"),
    }


async def auto_check(db, trip: Dict, lng: float, lat: float,
                     speed_kmph: Optional[float]) -> List[Dict]:
    """Run on every tracking ping. Returns newly created alerts (0-2)."""
    from app.services.tracking import progress_frac

    geom = (trip.get("route_geometry") or {}).get("coordinates")
    off_m = None
    if geom and len(geom) >= 2:
        off_m = progress_frac(geom, lng, lat)["off_route_m"]
    verdicts = [
        ("speed", speed_verdict(speed_kmph),
         {"speed_kmph": speed_kmph,
          "details": {"speed_kmph": speed_kmph}}),
        ("deviation", deviation_verdict(off_m),
         {"off_route_m": off_m, "details": {"deviation_m": off_m}}),
    ]
    created = []
    now = _utcnow()
    for atype, v, extra in verdicts:
        triggered = v.get("over") or v.get("deviated")
        if not triggered:
            continue
        dup = await db.safety_alerts.find_one(
            {"trip_id": trip["_id"], "type": atype, "status": "open"})
        if dup is not None:
            continue  # dedupe: one open alert per (trip, type)
        doc = {"trip_id": trip["_id"], "booking_id": None, "type": atype,
               "severity": v.get("severity") or "medium",
               "point": {"type": "Point", "coordinates": [lng, lat]},
               "details": dict(extra.get("details") or {}),
               "status": "open", "created_at": now, "resolved_at": None}
        if atype == "speed":
            doc["details"]["limit_kmph"] = 80.0
        res = await db.safety_alerts.insert_one(doc)
        doc["_id"] = res.inserted_id
        created.append(_out(doc))
        # Module 23: the driver and every admin hear about a new safety alert.
        from app.api.v1.notifications import emit  # lazy: avoids a router cycle

        await emit(db, "safety_alert", trip_id=str(trip["_id"]),
                   booking_id=str(doc["booking_id"]) if doc.get("booking_id") else None,
                   kind=atype, detail="Severity: " + doc["severity"],
                   _trip=trip)
    return created


@router.post("/sos")
async def sos(body: SosIn, user: Dict = Depends(get_current_user)):
    """Panic button: any active trip party raises a CRITICAL alert."""
    db = get_db()
    trip = await _trip_or_404(db, body.trip_id)
    if trip["status"] not in ("published", "ongoing"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip is " + str(trip.get("status")))
    await _assert_audience(db, trip, user)
    booking_oid = None
    if body.booking_id:
        b = await db.bookings.find_one({"_id": _oid(body.booking_id, "booking not found")})
        if b is None or str(b["trip_id"]) != str(trip["_id"]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "booking is not on this trip")
        booking_oid = b["_id"]
    now = _utcnow()
    fix = await db.locations.find_one({"trip_id": trip["_id"]},
                                      sort=[("recorded_at", -1)])
    point = fix["point"] if fix else None
    doc = {"trip_id": trip["_id"], "booking_id": booking_oid, "type": "sos",
           "severity": "critical", "point": point,
           "details": {"message": (body.message or "")[:500],
                       "raised_by": user["id"]},
           "status": "open", "created_at": now, "resolved_at": None}
    res = await db.safety_alerts.insert_one(doc)
    doc["_id"] = res.inserted_id
    # Module 23: SOS is a NEVER-dedupe event — two presses are two real
    # emergencies, so both driver and admins are notified every time.
    from app.api.v1.notifications import emit  # lazy: avoids a router cycle

    await emit(db, "sos", actor_id=user["id"], trip_id=str(trip["_id"]),
               booking_id=str(booking_oid) if booking_oid else None,
               who="A rider", detail=(body.message or "no message"),
               _trip=trip)
    return _out(doc)


@router.get("/trip/{trip_id}")
async def trip_alerts(trip_id: str, user: Dict = Depends(get_current_user)):
    """Alert banner feed for the trip audience (open first, newest first)."""
    db = get_db()
    trip = await _trip_or_404(db, trip_id)
    await _assert_audience(db, trip, user)
    cur = db.safety_alerts.find({"trip_id": trip["_id"]}).sort("created_at", -1).limit(50)
    docs = [d async for d in cur]
    docs.sort(key=lambda d: (d["status"] != "open",))
    return {"trip_id": str(trip["_id"]), "count": len(docs),
            "open": sum(1 for d in docs if d["status"] == "open"),
            "alerts": [_out(d) for d in docs]}


@router.post("/{alert_id}/ack")
async def ack(alert_id: str, user: Dict = Depends(get_current_user)):
    """Driver of the trip (or admin) acknowledges an open alert."""
    db = get_db()
    alert = await db.safety_alerts.find_one({"_id": _oid(alert_id, "alert not found")})
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found")
    trip = await db.trips.find_one({"_id": alert["trip_id"]})
    is_driver = trip is not None and str(trip["driver_id"]) == user["id"]
    is_admin = "admin" in (user.get("roles") or [])
    if not (is_driver or is_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the driver can acknowledge")
    if alert["status"] != "open":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only open alerts can be acknowledged")
    updated = await db.safety_alerts.find_one_and_update(
        {"_id": alert["_id"], "status": "open"},
        {"$set": {"status": "acknowledged"}}, return_document=True)
    # Module 23: admins watching the queue learn it was seen.
    from app.api.v1.notifications import emit  # lazy: avoids a router cycle

    await emit(db, "alert_acknowledged", actor_id=user["id"],
               trip_id=str(alert["trip_id"]), kind=alert["type"],
               who="The driver", _trip=trip)
    return _out(updated)

