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
from app.services.cost import compute_detour_contribution, resolve_fuel_price
from app.core.config import get_settings
from app.services.cost_sharing import (
    check_seats_left, compute_shares, CONFIRMED_STATUSES, cost_preview,
    get_fuel_unit, recompute_trip_fares,
)
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
        "passenger_distance_km": doc.get("passenger_distance_km"),
        "estimated_contribution": doc.get("estimated_contribution"),
        "amount": doc.get("amount") or doc.get("estimated_contribution") or doc.get("cost_share"),
        "fare_changed": doc.get("fare_changed", False),
        "previous_amount": doc.get("previous_amount"),
        "fare_history": doc.get("fare_history", []),
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
            "id": str(trip["_id"]),
            "source_name": trip["source"]["name"],
            "destination_name": trip["destination"]["name"],
            "source": trip.get("source"),
            "destination": trip.get("destination"),
            "route_geometry": trip.get("route_geometry"),
            "depart_at": trip["depart_at"],
            "status": trip["status"],
            "vehicle": ("{} {}".format(veh["make"], veh["model"])
                        + (" · " + veh["plate_no"] if veh else "")) if veh else None,
            "vehicle_details": {
                "make": (veh or {}).get("make"),
                "model": (veh or {}).get("model"),
                "plate_no": (veh or {}).get("plate_no"),
                "fuel_type": (veh or {}).get("fuel_type", "petrol"),
                "mileage_kmpl": (veh or {}).get("mileage_kmpl"),
            } if veh else None,
            "seats_offered": trip.get("seats_offered"),
            "seats_booked": trip.get("seats_booked", 0),
            "seats_left": max(0, int(trip.get("seats_offered", 1)) - int(trip.get("seats_booked", 0))),
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
        {"_id": doc["trip_id"], "status": {"$in": ["published", "ongoing"]}},
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
    if trip.get("status") not in ("published", "ongoing"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip is not open for bookings (" + str(trip.get("status")) + ")")
    depart = trip["depart_at"]
    if depart.tzinfo is None:
        depart = depart.replace(tzinfo=timezone.utc)
    if trip.get("status") != "ongoing":
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
        {"_id": trip["_id"], "status": {"$in": ["published", "ongoing"]},
         "$expr": {"$lte": [{"$add": ["$seats_booked", body.seats]},
                            "$seats_offered"]}},
        {"$inc": {"seats_booked": body.seats}})
    if reserved.modified_count == 0:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "not enough seats left for this request")

    now = _utcnow()
    p_dist = match.get("passenger_distance_km")
    detour_val = match.get("detour_km", detour_km)

    # --- project pickup/drop onto the route for segment costing -----------
    pickup_along_km = None
    drop_along_km = None
    geom = (trip.get("route_geometry") or {}).get("coordinates")
    if geom and len(geom) >= 2:
        # Prefer Module 10 snapshot values from match_explain if present.
        me_pickup = (match.get("match_explain") or {}).get("pickup", {})
        me_drop = (match.get("match_explain") or {}).get("drop", {})
        if me_pickup.get("along_km") is not None:
            pickup_along_km = float(me_pickup["along_km"])
        else:
            proj = project_onto_route(body.pickup_coordinates, geom)
            pickup_along_km = float(proj["frac"]) * float(trip.get("distance_km") or route_length_km(geom))
        if me_drop.get("along_km") is not None:
            drop_along_km = float(me_drop["along_km"])
        else:
            proj = project_onto_route(body.dropoff_coordinates, geom)
            drop_along_km = float(proj["frac"]) * float(trip.get("distance_km") or route_length_km(geom))
    pickup_along_km = max(0.0, min(float(trip.get("distance_km") or 0), pickup_along_km or 0.0))
    drop_along_km = max(0.0, min(float(trip.get("distance_km") or 0), drop_along_km or float(trip.get("distance_km") or 0)))
    if drop_along_km <= pickup_along_km:
        drop_along_km = min(float(trip.get("distance_km") or 0), pickup_along_km + 1.0)

    # --- segment-based preview: what this passenger would pay ------------
    preview = await cost_preview(
        trip, pickup_along_km, drop_along_km, requested_seats=body.seats, db=db,
    )
    est_contrib = preview.get("estimated_contribution")
    if preview.get("can_book") is False and preview.get("available") is not False:
        # Release the reserved seats before rejecting.
        await db.trips.update_one(
            {"_id": trip["_id"], "status": {"$in": ["published", "ongoing"]}},
            {"$inc": {"seats_booked": -int(body.seats)}})
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "not enough seats left for this request")

    doc = {
        "trip_id": trip["_id"],
        "passenger_id": ObjectId(user["id"]),
        "driver_id": trip["driver_id"],
        "seats": body.seats,
        "pickup": {"name": pickup_name, "point": pickup_point},
        "dropoff": {"name": None, "point": dropoff_point},
        "pickup_distance_m": pickup_distance_m,
        "detour_km": detour_val,
        "passenger_distance_km": p_dist,
        "pickup_along_km": pickup_along_km,
        "drop_along_km": drop_along_km,
        "estimated_contribution": est_contrib,
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
    # Recompute all confirmed fares with the segment engine; idempotent.
    await recompute_trip_fares(db, doc["trip_id"], reason="booking_accepted")
    # Notify other passengers whose share changed (recompute_trip_fares sets
    # fare_changed; this best-effort ping never fails the accept).
    try:
        from app.api.v1.notifications import notify_booking
        await notify_booking(db, "fare_changed", updated, actor_id=user["id"])
    except Exception:
        pass
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
    await recompute_trip_fares(db, doc["trip_id"], reason="booking_rejected")
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
    await recompute_trip_fares(db, doc["trip_id"], reason="booking_confirmed")
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
    if trip is not None and trip.get("status") in ("published", "ongoing"):
        await _release_seats(db, doc)
    await _recalculate(db, doc["trip_id"])
    await recompute_trip_fares(db, doc["trip_id"], reason="booking_cancelled")
    # Module 23: tell the OTHER side; `_notify` never lets this fail the cancel.
    await _notify(db, "booking_cancelled", updated, actor_id=user["id"])
    return await _out(db, updated)


@router.get("/{booking_id}/accept-preview")
async def accept_preview(booking_id: str, user: Dict = Depends(get_current_user)):
    """Return the fare split BEFORE and AFTER accepting this booking.

    Driver sees each passenger's amount, the driver's remaining amount,
    and seats left in both scenarios — before approving.
    """
    db = get_db()
    doc = await _get_booking(db, booking_id)
    trip = await _owning_trip(db, doc, user)
    if doc["status"] != "requested":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only requested bookings can be previewed")

    route_km = float(trip.get("route_km") or trip.get("distance_km") or 0)
    mileage = trip.get("vehicle_mileage_kmpl")
    fuel_price = trip.get("fuel_price_per_unit") or trip.get("fuel_price")
    route_coords = (trip.get("route_geometry") or {}).get("coordinates")

    # Resolve mileage/fuel from vehicle snapshot if not on trip
    if (not mileage or not fuel_price) and trip.get("vehicle_id"):
        veh = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
        if veh:
            mileage = mileage or veh.get("mileage_kmpl")
            if not fuel_price:
                from app.services.cost import resolve_fuel_price
                fuel_price = resolve_fuel_price(veh.get("fuel_type"),
                                                trip.get("price_policy"))

    if not mileage or not fuel_price or route_km <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip has no fuel price or mileage snapshot")

    mileage = float(mileage)
    fuel_price = float(fuel_price)

    # Currently confirmed bookings (BEFORE accepting this one)
    cursor = db.bookings.find({
        "trip_id": trip["_id"],
        "status": {"$in": list(CONFIRMED_STATUSES)},
    })
    before_bookings = await cursor.to_list(100)
    before = compute_shares(
        route_km=route_km, mileage=mileage, fuel_price=fuel_price,
        bookings=before_bookings, round_mode=get_settings().ROUND_MODE,
        route_coords=route_coords,
    )

    # AFTER: add this booking as accepted
    candidate = {
        "_id": doc["_id"],
        "id": str(doc["_id"]),
        "status": "accepted",
        "seats": int(doc.get("seats", 1)),
        "pickup_along_km": doc.get("pickup_along_km", 0.0),
        "drop_along_km": doc.get("drop_along_km", float(route_km)),
    }
    after = compute_shares(
        route_km=route_km, mileage=mileage, fuel_price=fuel_price,
        bookings=before_bookings + [candidate],
        round_mode=get_settings().ROUND_MODE,
        route_coords=route_coords,
    )

    p_seats = int(trip.get("passenger_seats") or trip.get("seats_offered") or 4)
    seats_left_before = check_seats_left(
        route_km, p_seats, before_bookings,
        float(doc.get("pickup_along_km", 0.0)),
        float(doc.get("drop_along_km", route_km)), route_coords,
    )
    seats_left_after = check_seats_left(
        route_km, p_seats, before_bookings + [candidate],
        float(doc.get("pickup_along_km", 0.0)),
        float(doc.get("drop_along_km", route_km)), route_coords,
    )

    return {
        "booking_id": str(doc["_id"]),
        "route_km": route_km,
        "fuel_unit": get_fuel_unit(trip.get("fuel_type")),
        "before": {
            "passengers": before["passengers"],
            "driver_share": before["driver_share"],
            "total_cost": before["total_cost"],
            "seats_left": seats_left_before,
        },
        "after": {
            "passengers": after["passengers"],
            "driver_share": after["driver_share"],
            "total_cost": after["total_cost"],
            "seats_left": seats_left_after,
        },
    }