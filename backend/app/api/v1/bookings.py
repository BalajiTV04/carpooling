"""Booking routes (Module 11): request -> accept/reject -> confirm (+cancel).

ATOMIC SEATS: creating a booking reserves seats with a conditional $inc
(`$expr` guard `seats_booked + seats <= seats_offered`), so two passengers
requesting the last seat simultaneously cannot both succeed. Reject/cancel
release the seats. Accept/confirm never touch the counter.

SNAPSHOTS: at request time we freeze the Module 10 optimised pickup point
(walk/door strategy + detour) and the Module 9 match (overlap %) onto the
booking — later route edits can't rewrite history, and the cost engine
(Module 12) prices what was actually agreed.

Rules: verified phone to book; no booking your own trip; one ACTIVE booking
per passenger per trip (409); transitions role-gyped and status-guarded;
trip must be published with future departure.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.booking import BookingIn, BookingOut
from app.services.booking_window import check_window
from app.services.geo_math import (
    haversine_km,
    point_at_km,
    project_onto_route,
    route_length_km,
)
from app.services.matching import match_fallback, match_trip
from app.services.pickup import optimise_pickup_point
from app.services.ranker import enrich_match

# cost.py/segments.py import nothing from bookings; the Module 13 recalc hook
# (persist_segments) lives in segments.py and only needs (db, trip).
async def _recalculate(db, trip_id):
    """Module 13: rebuild per-leg segments AND rewrite cost_shares."""
    from app.api.v1.segments import persist_segments

    trip = await db.trips.find_one({"_id": trip_id})
    if trip is None:
        return 0
    return await persist_segments(db, trip)


async def _notify(db, event: str, booking: Dict, actor_id=None, **extra):
    """Module 23: best-effort notification for a booking transition.

    Wrapped twice over — `emit()` never raises, and this swallows anything
    else — because a notification must never fail a booking transition.
    """
    try:
        from app.api.v1.notifications import notify_booking

        return await notify_booking(db, event, booking, actor_id=actor_id, **extra)
    except Exception:
        return {"emitted": 0, "skipped": 0, "error": "swallowed"}

router = APIRouter(prefix="/bookings", tags=["bookings"])

ACTIVE_STATUSES = ("requested", "accepted", "confirmed")
WALK_SPEED_KMPH = 4.8
CITY_SPEED_KMPH = 25.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(v)


async def _out(db, doc: Dict, expand: bool = True) -> Dict:
    row = {
        "id": str(doc["_id"]),
        "trip_id": str(doc["trip_id"]),
        "passenger_id": str(doc["passenger_id"]),
        "driver_id": str(doc["driver_id"]),
        "seats": doc["seats"],
        "status": doc["status"],
        "pickup": doc.get("pickup", {}),
        "dropoff": doc.get("dropoff", {}),
        "pickup_distance_m": doc.get("pickup_distance_m"),
        "detour_km": doc.get("detour_km"),
        "overlap_pct": doc.get("overlap_pct"),
        "match_score": doc.get("match_score"),
        "ai_score": doc.get("ai_score"),
        "ai_model": doc.get("ai_model"),
        "cost_share": doc.get("cost_share"),
        "closed_at": doc.get("closed_at"),
        "closure_note": doc.get("closure_note"),
        "created_at": doc.get("created_at"),
    }
    if not expand:
        return row
    trip = await db.trips.find_one({"_id": doc["trip_id"]})
    if trip:
        veh = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
        row["trip"] = {
            "source_name": trip["source"]["name"],
            "destination_name": trip["destination"]["name"],
            "depart_at": trip["depart_at"],
            "status": trip["status"],
            "vehicle": ("{} {}".format(veh["make"], veh["model"])
                        + (" · " + veh["plate_no"] if veh else "")) if veh else None,
            "seats_offered": trip.get("seats_offered"),
        }
    for key, uid in (("passenger_name", doc["passenger_id"]),
                     ("driver_name", doc["driver_id"])):
        u = await db.users.find_one({"_id": uid}, {"full_name": 1})
        row[key] = (u or {}).get("full_name")
    return row


async def _get_booking(db, booking_id: str) -> Dict:
    doc = await db.bookings.find_one({"_id": _oid(booking_id, "booking not found")})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "booking not found")
    return doc


async def _owning_trip(db, doc: Dict, user: Dict) -> Dict:
    trip = await db.trips.find_one({"_id": doc["trip_id"]})
    if trip is None or str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the driver of this trip")
    return trip


async def _release_seats(db, doc: Dict) -> None:
    await db.trips.update_one(
        {"_id": doc["trip_id"], "status": "published"},
        {"$inc": {"seats_booked": -int(doc["seats"])}})

@router.post("", response_model=BookingOut, status_code=201)
async def create_booking(body: BookingIn, user: Dict = Depends(get_current_user)):
    if not user.get("phone_verified"):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "verify your phone before booking")
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(body.trip_id, "trip not found")})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if str(trip["driver_id"]) == user["id"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "you cannot book your own trip")
    if trip.get("status") != "published":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip is not open for bookings (" + str(trip.get("status")) + ")")
    depart = trip["depart_at"]
    if depart.tzinfo is None:
        depart = depart.replace(tzinfo=timezone.utc)
    if depart <= _utcnow():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "this trip has already departed")
    # Module 14: advance-booking window (opens/closes are derived, never stored)
    win = check_window(depart, trip.get("advance_policy"))
    if not win["bookable"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, win["reason"])
    dup = await db.bookings.find_one({
        "trip_id": trip["_id"], "passenger_id": ObjectId(user["id"]),
        "status": {"$in": list(ACTIVE_STATUSES)}})
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "you already have an active booking on this trip")

    # --- snapshots: pickup optimisation (M10) + match explain (M9) ---------
    src = trip["source"]["point"]["coordinates"]
    dst = trip["destination"]["point"]["coordinates"]
    pickup_name = None
    pickup_point = {"type": "Point", "coordinates": list(body.pickup_coordinates)}
    dropoff_point = {"type": "Point", "coordinates": list(body.dropoff_coordinates)}
    pickup_distance_m = round(haversine_km(body.pickup_coordinates, src) * 1000, 0)
    detour_km = None
    geom = (trip.get("route_geometry") or {}).get("coordinates")
    if geom and len(geom) >= 2 and body.use_optimised_pickup:
        opt = optimise_pickup_point(geom, body.pickup_coordinates,
                                    body.dropoff_coordinates)
        chosen = opt.get("chosen")
        if chosen is not None:
            pickup_point = {"type": "Point", "coordinates": chosen["coordinates"]}
            pickup_name = chosen.get("label")
            pickup_distance_m = round(chosen["walk_km"] * 1000, 0)
            detour_km = chosen["detour_km"]
    elif geom and len(geom) >= 2:
        # optimiser declined (or disabled): report the deviation estimate at
        # the projection foot and board there — never a mid-air coordinate.
        proj = project_onto_route(body.pickup_coordinates, geom)
        foot_km = proj["frac"] * route_length_km(geom)
        foot_pt = point_at_km(geom, foot_km) or body.pickup_coordinates
        detour_km = round(max(0.0, 2 * proj["dist_km"]), 3)
        pickup_point = {"type": "Point",
                        "coordinates": [round(foot_pt[0], 6), round(foot_pt[1], 6)]}
    if geom and len(geom) >= 2:
        match = match_trip(geom, body.pickup_coordinates, body.dropoff_coordinates)
    else:
        match = match_fallback(src, dst, body.pickup_coordinates, body.dropoff_coordinates)
    # Module 16: freeze the AI score alongside the rule snapshot (history-proof).
    enrich_match(match)

    # --- atomic seat reservation (no oversell under concurrency) -----------
    reserved = await db.trips.update_one(
        {"_id": trip["_id"], "status": "published",
         "$expr": {"$lte": [{"$add": ["$seats_booked", body.seats]},
                            "$seats_offered"]}},
        {"$inc": {"seats_booked": body.seats}})
    if reserved.modified_count == 0:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "not enough seats left for this request")

    now = _utcnow()
    doc = {
        "trip_id": trip["_id"],
        "passenger_id": ObjectId(user["id"]),
        "driver_id": trip["driver_id"],
        "seats": body.seats,
        "pickup": {"name": pickup_name, "point": pickup_point},
        "dropoff": {"name": None, "point": dropoff_point},
        "pickup_distance_m": pickup_distance_m,
        "detour_km": detour_km,
        "overlap_pct": match.get("overlap_pct"),
        "match_score": match.get("score"),
        "match_explain": match,
        "ai_score": match.get("ai_score"),
        "ai_model": match.get("ai_model"),
        "cost_share": None,
        "status": "requested",
        "created_at": now,
        "updated_at": now,
    }
    res = await db.bookings.insert_one(doc)
    created = await db.bookings.find_one({"_id": res.inserted_id})
    # Module 23: the driver is told a seat was requested.
    await _notify(db, "booking_requested", created, actor_id=user["id"])
    return await _out(db, created)


@router.get("/mine", response_model=List[BookingOut])
async def my_bookings(user: Dict = Depends(get_current_user)):
    """Passenger view: my requests across all trips, newest first."""
    db = get_db()
    cur = db.bookings.find({"passenger_id": ObjectId(user["id"])}).sort("created_at", -1)
    return [await _out(db, d) async for d in cur]


@router.get("/incoming", response_model=List[BookingOut])
async def incoming_bookings(user: Dict = Depends(get_current_user)):
    """Driver view: requests on my trips (any status) for the requests panel."""
    db = get_db()
    cur = db.bookings.find({"driver_id": ObjectId(user["id"])}).sort(
        "created_at", -1).limit(100)
    return [await _out(db, d) async for d in cur]


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(booking_id: str, user: Dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_booking(db, booking_id)
    if user["id"] not in (str(doc["passenger_id"]), str(doc["driver_id"])):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your booking")
    return await _out(db, doc)


@router.post("/{booking_id}/accept", response_model=BookingOut)
async def accept_booking(booking_id: str, user: Dict = Depends(get_current_user)):
    """Driver accepts a requested booking. Seats were reserved at request time,
    so accepting never changes the counter."""
    db = get_db()
    doc = await _get_booking(db, booking_id)
    trip = await _owning_trip(db, doc, user)
    _ = trip
    if doc["status"] != "requested":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only requested bookings can be accepted")
    updated = await db.bookings.find_one_and_update(
        {"_id": doc["_id"], "status": "requested"},
        {"$set": {"status": "accepted", "updated_at": _utcnow()}},
        return_document=True)
    await _recalculate(db, doc["trip_id"])  # simple M12 version (M13 upgrades)
    await _notify(db, "booking_accepted", updated, actor_id=user["id"])
    return await _out(db, updated)


@router.post("/{booking_id}/reject", response_model=BookingOut)
async def reject_booking(booking_id: str, user: Dict = Depends(get_current_user)):
    """Driver rejects: booking -> rejected AND the reserved seats go back."""
    db = get_db()
    doc = await _get_booking(db, booking_id)
    await _owning_trip(db, doc, user)
    if doc["status"] != "requested":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only requested bookings can be rejected")
    updated = await db.bookings.find_one_and_update(
        {"_id": doc["_id"], "status": "requested"},
        {"$set": {"status": "rejected", "updated_at": _utcnow()}},
        return_document=True)
    await _release_seats(db, doc)
    await _recalculate(db, doc["trip_id"])
    await _notify(db, "booking_rejected", updated, actor_id=user["id"])
    return await _out(db, updated)


@router.post("/{booking_id}/confirm", response_model=BookingOut)
async def confirm_booking(booking_id: str, user: Dict = Depends(get_current_user)):
    """Passenger confirms the driver's acceptance — final lock-in."""
    db = get_db()
    doc = await _get_booking(db, booking_id)
    if str(doc["passenger_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your booking")
    if doc["status"] != "accepted":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only accepted bookings can be confirmed")
    updated = await db.bookings.find_one_and_update(
        {"_id": doc["_id"], "status": "accepted"},
        {"$set": {"status": "confirmed", "updated_at": _utcnow()}},
        return_document=True)
    await _recalculate(db, doc["trip_id"])
    refreshed = await db.bookings.find_one({"_id": doc["_id"]})
    return await _out(db, refreshed)


@router.post("/{booking_id}/cancel", response_model=BookingOut)
async def cancel_booking(booking_id: str, user: Dict = Depends(get_current_user)):
    """Passenger (own booking) or trip driver cancels; seats released while
    the trip is still published (ongoing trips keep the accounting frozen)."""
    db = get_db()
    doc = await _get_booking(db, booking_id)
    trip = await db.trips.find_one({"_id": doc["trip_id"]})
    is_passenger = str(doc["passenger_id"]) == user["id"]
    is_driver = trip is not None and str(trip["driver_id"]) == user["id"]
    if not (is_passenger or is_driver):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your booking")
    if doc["status"] not in ACTIVE_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "cannot cancel a " + doc["status"] + " booking")
    updated = await db.bookings.find_one_and_update(
        {"_id": doc["_id"], "status": {"$in": list(ACTIVE_STATUSES)}},
        {"$set": {"status": "cancelled", "updated_at": _utcnow()}},
        return_document=True)
    if trip is not None and trip.get("status") == "published":
        await _release_seats(db, doc)
    await _recalculate(db, doc["trip_id"])
    # Module 23: tell the OTHER side; `_notify` never lets this fail the cancel.
    await _notify(db, "booking_cancelled", updated, actor_id=user["id"])
    return await _out(db, updated)