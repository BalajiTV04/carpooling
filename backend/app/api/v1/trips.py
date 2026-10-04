"""Trip routes (Module 6): driver publishes source/dest/date/time/seats.

Gates (checked IN ORDER, first failure wins):
1. driver role (require_roles)  2. phone verified  3. vehicle owned+active
4. vehicle verified  5. seats_offered <= vehicle.seats_total
6. depart_at in future (validator)  7. source != destination (>500m apart)

Lifecycle: draft -> published -> ongoing -> completed, or -> cancelled.
Publish is explicit (POST /{id}/publish) so drivers can stage drafts.
Edit allowed in draft/published only; lowering seats below seats_booked is
rejected (protects accepted passengers — Module 11 writes seats_booked).
Cancel allowed until ongoing; delete allowed for draft/cancelled only.

Module 7 addition: create attempts an OSRM route (best-effort, never blocks
the save). Routed trips get route_geometry + routed distance/duration;
offline trips keep crow-flies + route_geometry=None (refresh later via
POST /trips/{id}/route/refresh in geo.py).
"""
from datetime import datetime, timezone
from typing import Dict, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.trip import TripIn, TripOut, TripUpdateIn
from app.services.booking_window import normalise_policy
from app.services.geo_math import haversine_km as _haversine_km
from app.services.routing import osrm_route

router = APIRouter(prefix="/trips", tags=["trips"])
_driver = require_roles("driver")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str = "trip not found") -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(v)


def _out(doc: Dict) -> Dict:
    from app.services.booking_window import normalise_policy, window

    w = window(doc["depart_at"], doc.get("advance_policy"))
    return {
        "id": str(doc["_id"]),
        "source_name": doc["source"]["name"],
        "destination_name": doc["destination"]["name"],
        "source": doc["source"],
        "destination": doc["destination"],
        "depart_at": doc["depart_at"],
        "seats_offered": doc["seats_offered"],
        "seats_booked": doc.get("seats_booked", 0),
        "seats_left": doc["seats_offered"] - doc.get("seats_booked", 0),
        "vehicle_id": str(doc["vehicle_id"]),
        "status": doc["status"],
        "distance_km": doc.get("distance_km"),
        "duration_min": doc.get("duration_min"),
        # Module 14: window is derived, never stored — one source of truth.
        "booking_opens_at": w["opens_at"].isoformat(),
        "booking_closes_at": w["closes_at"].isoformat(),
        "advance_policy": normalise_policy(doc.get("advance_policy")),
        "recurring_group_id": (str(doc["recurring_group_id"])
                               if doc.get("recurring_group_id") else None),
        "created_at": doc.get("created_at"),
    }


async def _checked_vehicle(db, vehicle_id: str, user_id: str) -> Dict:
    veh = await db.vehicles.find_one(
        {"_id": _oid(vehicle_id, "vehicle not found"),
         "owner_id": ObjectId(user_id)})
    if veh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    if not veh.get("is_active", True):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "vehicle is deactivated")
    if veh.get("verification_status") != "verified":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "vehicle not verified — admin approval needed")
    return veh


@router.post("", response_model=TripOut, status_code=201)
async def create_trip(body: TripIn, user: Dict = Depends(_driver)):
    if not user.get("phone_verified"):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "verify phone before publishing trips")
    db = get_db()
    veh = await _checked_vehicle(db, body.vehicle_id, user["id"])
    if body.seats_offered > int(veh.get("seats_total", 1)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "seats_offered exceeds vehicle capacity "
                            + str(veh.get("seats_total")))
    dist = _haversine_km(body.source.coordinates, body.destination.coordinates)
    if dist < 0.5:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "source and destination too close (<500m)")
    now = _utcnow()
    # Module 7: best-effort OSRM route. Failure keeps crow-flies + None
    # geometry — the save MUST NOT fail because routing is down.
    routed = await osrm_route(body.source.coordinates, body.destination.coordinates)
    doc = {
        "driver_id": ObjectId(user["id"]),
        "vehicle_id": veh["_id"],
        "source": body.source.to_place(),
        "destination": body.destination.to_place(),
        "route_geometry": routed["geometry"] if routed else None,
        "distance_km": routed["distance_km"] if routed else round(dist, 2),
        "duration_min": routed["duration_min"] if routed else None,
        "depart_at": body.depart_at,
        "seats_offered": body.seats_offered,
        "seats_booked": 0,
        "price_policy": None,
        # Module 14: normalised window policy (defaults from Settings).
        "advance_policy": normalise_policy(body.advance_policy),
        # Module 15: recurrence tag set by /recurring; standalone trips None.
        "recurring_group_id": None,
        "status": "draft",
        "created_at": now,
        "updated_at": now,
    }
    res = await db.trips.insert_one(doc)
    created = await db.trips.find_one({"_id": res.inserted_id})
    return _out(created)


# Module 25: `/mine` is declared ABOVE `/{trip_id}` ON PURPOSE. FastAPI matches
# routes in registration order, so a `/{trip_id}` route defined first swallows
# the literal string "mine" as a trip id and the driver's My Trips page returns
# 404 "trip not found" with no other symptom. test_deploy asserts this ordering
# for every router in the project.
@router.get("/mine", response_model=List[TripOut])
async def list_my_trips(
    user: Dict = Depends(_driver),
    status_: str = Query(default=""),
):
    """My trips, soonest first. Optional ?status= filter."""
    db = get_db()
    q = {"driver_id": ObjectId(user["id"])}  # type: Dict
    if status_:
        if status_ not in ("draft", "published", "ongoing", "completed", "cancelled"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad status filter")
        q["status"] = status_
    cur = db.trips.find(q).sort("depart_at", 1)
    return [_out(d) async for d in cur]


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(trip_id: str, user: Dict = Depends(get_current_user)):
    _ = user  # any logged-in user may view (passengers need this for search M8)
    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    return _out(doc)


@router.patch("/{trip_id}", response_model=TripOut)
async def update_trip(trip_id: str, body: TripUpdateIn, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] not in ("draft", "published"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only draft/published trips can be edited")
    patch = {}
    if body.source is not None:
        patch["source"] = body.source.to_place()
    if body.destination is not None:
        patch["destination"] = body.destination.to_place()
    if body.depart_at is not None:
        patch["depart_at"] = body.depart_at
    if body.seats_offered is not None:
        if body.seats_offered < int(doc.get("seats_booked", 0)):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "cannot offer fewer seats than already booked")
        veh = await db.vehicles.find_one({"_id": doc["vehicle_id"]})
        cap = int(veh.get("seats_total", 7)) if veh else 7
        if body.seats_offered > cap:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "seats_offered exceeds vehicle capacity " + str(cap))
        patch["seats_offered"] = body.seats_offered
    if ("source" in patch) or ("destination" in patch):
        src = patch.get("source", doc["source"])
        dst = patch.get("destination", doc["destination"])
        if _haversine_km(src["point"]["coordinates"], dst["point"]["coordinates"]) < 0.5:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "source and destination too close (<500m)")
        patch["distance_km"] = round(_haversine_km(
            src["point"]["coordinates"], dst["point"]["coordinates"]), 2)
        patch["route_geometry"] = None  # endpoints moved -> re-route in Module 7
    if not patch:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nothing to update")
    patch["updated_at"] = _utcnow()
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]}, {"$set": patch}, return_document=True)
    return _out(updated)


@router.post("/{trip_id}/publish", response_model=TripOut)
async def publish_trip(trip_id: str, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] != "draft":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only drafts can be published")
    # Re-check gates at publish time (vehicle may have been edited/rejected).
    if not user.get("phone_verified"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "verify phone first")
    await _checked_vehicle(db, str(doc["vehicle_id"]), user["id"])
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"status": "published", "updated_at": _utcnow()}},
        return_document=True)
    return _out(updated)


@router.post("/{trip_id}/cancel", response_model=TripOut)
async def cancel_trip(trip_id: str, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] in ("ongoing", "completed", "cancelled"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "cannot cancel " + doc["status"] + " trip")
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"status": "cancelled", "updated_at": _utcnow()}},
        return_document=True)
    return _out(updated)


@router.delete("/{trip_id}")
async def delete_trip(trip_id: str, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] not in ("draft", "cancelled"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only draft/cancelled trips can be deleted")
    await db.trips.delete_one({"_id": doc["_id"]})
    return {"deleted": True, "id": str(doc["_id"])}


@router.get("/{trip_id}/bookability")
async def trip_bookability(trip_id: str, user: Dict = Depends(get_current_user)):
    """Module 14: can passengers book this trip right now, and why/why not."""
    _ = user
    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    from app.services.booking_window import check_window

    result = check_window(doc["depart_at"], doc.get("advance_policy"))
    result["trip"] = {"id": str(doc["_id"]), "status": doc["status"],
                      "seats_left": doc["seats_offered"] - doc.get("seats_booked", 0)}
    return result


@router.post("/{trip_id}/advance-policy", response_model=TripOut)
async def set_advance_policy(
    trip_id: str,
    max_days_advance: int = Query(default=30, ge=1, le=180),
    min_notice_min: int = Query(default=60, ge=0, le=1440),
    user: Dict = Depends(_driver),
):
    """Owner-only window tuning (Module 14). Applies to draft/published trips;
    ongoing/completed/cancelled are immutable."""
    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if str(doc["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your trip")
    if doc["status"] not in ("draft", "published"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "window is fixed once the trip is " + doc["status"])
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"advance_policy": normalise_policy({
            "max_days_advance": max_days_advance,
            "min_notice_min": min_notice_min}),
            "updated_at": _utcnow()}},
        return_document=True)
    return _out(updated)


# ---------------------------------------------------------------------------
# Module 19: trip start / completion / receipt (closes the lifecycle)
# ---------------------------------------------------------------------------
@router.post("/{trip_id}/start", response_model=TripOut)
async def start_trip(trip_id: str, user: Dict = Depends(_driver)):
    """Explicit published -> ongoing. Tracking's first ping does this too; this
    route exists so a driver can start without sharing location yet."""
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] != "published":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only published trips can be started ("
                            + str(doc["status"]) + ")")
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"], "status": "published"},
        {"$set": {"status": "ongoing", "started_at": _utcnow(),
                  "updated_at": _utcnow()}},
        return_document=True)
    if updated is None:  # lost a race with another start/ping
        updated = await db.trips.find_one({"_id": doc["_id"]})
    return _out(updated)


@router.post("/{trip_id}/complete")
async def complete_trip(trip_id: str, user: Dict = Depends(_driver)):
    """Driver closes the ride: published|ongoing -> completed.

    One atomic-ish sequence (all idempotent on retry):
    1. guard the transition (Module 19 rules);
    2. persist final segments/cost_shares while the trip is still open, so the
       receipt prices what actually happened (Modules 12/13);
    3. resolve every open booking (requested -> rejected, accepted/confirmed ->
       completed) — seats are FROZEN, nothing is released;
    4. stamp completed_at and return the receipt.
    """
    from app.services.lifecycle import completion_guard, resolve_completion, summarise

    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    guard = completion_guard(doc.get("status"))
    if not guard["allowed"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, guard["reason"])

    # 2. final money pass BEFORE flipping the status (segments endpoint refuses
    #    completed trips, which is exactly the freeze we want afterwards).
    from app.api.v1.segments import persist_segments

    segments = await persist_segments(db, doc)

    # 3. resolve bookings
    now = _utcnow()
    open_docs = await db.bookings.find({
        "trip_id": doc["_id"],
        "status": {"$in": ["requested", "accepted", "confirmed"]}}).to_list(200)
    plan = resolve_completion(open_docs)
    for t in plan["transitions"]:
        await db.bookings.update_one(
            {"_id": ObjectId(t["id"]), "status": t["from"]},
            {"$set": {"status": t["to"], "closed_at": now, "updated_at": now,
                      **({"closure_note": t["note"]} if t.get("note") else {})}})

    # 4. flip the trip (conditional: a concurrent cancel wins the race)
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"], "status": {"$in": list(("published", "ongoing"))}},
        {"$set": {"status": "completed", "completed_at": now,
                  "updated_at": now}},
        return_document=True)
    if updated is None:
        fresh = await db.trips.find_one({"_id": doc["_id"]})
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "trip changed state while completing (now "
                            + str((fresh or {}).get("status")) + ")")

    final_bookings = await db.bookings.find(
        {"trip_id": doc["_id"]}).to_list(200)
    receipt = summarise(updated, final_bookings, plan)
    receipt["segments_persisted"] = segments

    # Module 23: every rider is nudged to leave a rating (Module 22 consumes
    # exactly this). Best-effort — never blocks the receipt.
    try:
        from app.api.v1.notifications import emit  # lazy: avoids a router cycle

        for b in final_bookings:
            if b.get("status") == "completed":
                await emit(db, "trip_completed", actor_id=user["id"],
                           booking_id=str(b["_id"]), trip_id=str(doc["_id"]),
                           driver=doc.get("driver_name") or "your driver",
                           _booking=b, _trip=updated)
    except Exception:
        pass
    return receipt


@router.get("/{trip_id}/summary")
async def trip_summary(trip_id: str, user: Dict = Depends(get_current_user)):
    """Post-trip receipt for the driver + every passenger who rode (or still
    holds a booking on) the trip. Read-only — never recomputes money."""
    from app.services.lifecycle import summarise

    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    is_driver = str(doc["driver_id"]) == user["id"]
    if not is_driver:
        held = await db.bookings.find_one({
            "trip_id": doc["_id"], "passenger_id": ObjectId(user["id"]),
            "status": {"$in": ["requested", "accepted", "confirmed",
                               "completed"]}})
        if held is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "not a party to this trip")
    bookings = await db.bookings.find({"trip_id": doc["_id"]}).to_list(200)
    receipt = summarise(doc, bookings)
    receipt["completed"] = doc.get("status") == "completed"
    if not receipt["completed"]:
        receipt["note"] = ("Trip is " + str(doc.get("status"))
                           + " — numbers are provisional until completion.")
    return receipt
