"""Segment endpoints (Module 13): per-leg split views + rebuild hook.

- GET  /trips/{id}/segments          legs (422 when the trip has no geometry)
- GET  /trips/{id}/segments/summary  full driver/passenger picture
- POST /trips/{id}/segments/rebuild  owner-only, idempotent persist hook

Trips WITHOUT geometry fall back to the Module 12 whole-trip numbers
(`segmented: false`) — no regression for offline-saved trips.
"""
from datetime import datetime, timezone
from typing import Dict, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.segment import SegmentOut
from app.services.cost import distribute, resolve_fuel_price, total_fuel_cost
from app.services.segments import build_segments
from app.services.stops import stops_from_bookings

router = APIRouter(tags=["segments"])


def _oid(v: str) -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    return ObjectId(v)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
async def _split_view(db, trip: Dict) -> Dict:
    """One shared computation for GET + rebuild + recalc hook."""
    geom = (trip.get("route_geometry") or {}).get("coordinates") or []
    veh = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
    policy = trip.get("price_policy") or {"mode": "split_equal"}
    fuel_price = resolve_fuel_price((veh or {}).get("fuel_type"), policy)
    fuel = total_fuel_cost(trip.get("distance_km"),
                           (veh or {}).get("mileage_kmpl"), fuel_price)
    mode = policy.get("mode", "split_equal")
    seats_offered = int(trip.get("seats_offered", 1))

    docs = await db.bookings.find(
        {"trip_id": trip["_id"],
         "status": {"$in": ["confirmed", "accepted"]}}).sort("created_at", 1).to_list(50)
    riders = stops_from_bookings(trip, docs)

    if not geom or len(geom) < 2:
        confirmed = [{"id": str(d["_id"]), "seats": int(d.get("seats", 1))}
                     for d in docs]
        return {
            "segmented": False,
            "reason": "trip has no route geometry — whole-trip split applies",
            "segments": [], "totals": distribute(mode, fuel["total_cost"],
                                                 seats_offered, confirmed),
            "fuel": fuel, "policy": {"mode": mode, "fuel_price": fuel_price},
            "riders": len(riders),
        }

    price_per_km = (fuel["total_cost"] / fuel["distance_km"]
                    if fuel["distance_km"] > 0 else 0.0)
    built = build_segments(geom, trip["source"]["name"], trip["destination"]["name"],
                           riders, seats_offered, mode, round(price_per_km, 4))
    names = {}
    for d in docs:
        u = await db.users.find_one({"_id": d["passenger_id"]}, {"full_name": 1})
        names[str(d["_id"])] = (u or {}).get("full_name", "?")
    for seg in built["segments"]:
        seg["trip_id"] = str(trip["_id"])
        seg["occupant_names"] = [names.get(bid, "?") for bid in seg["occupant_ids"]]
    built.update({
        "segmented": True,
        "fuel": fuel,
        "policy": {"mode": mode, "fuel_price": fuel_price},
        "vehicle": {"fuel_type": (veh or {}).get("fuel_type"),
                    "mileage_kmpl": (veh or {}).get("mileage_kmpl")},
        "riders": len(riders),
        "seats_offered": seats_offered,
    })
    # Safety net: a confirmed rider the leg-builder could not place (e.g. their
    # drop-off projects upstream of their pickup) still gets a Module 12
    # whole-trip share, so nobody's cost_share is ever left stale.
    placed = set(built["totals"])
    leftovers = [{"id": str(d["_id"]), "seats": int(d.get("seats", 1))}
                 for d in docs if str(d["_id"]) not in placed]
    if leftovers:
        whole = distribute(mode, fuel["total_cost"], seats_offered,
                           [{"id": str(d["_id"]), "seats": int(d.get("seats", 1))}
                            for d in docs])
        for d in leftovers:
            built["totals"][d["id"]] = whole.get(d["id"], 0.0)
        built["fallback_riders"] = [d["id"] for d in leftovers]
    return built



@router.get("/trips/{trip_id}/segments", response_model=List[SegmentOut])
async def trip_segments(trip_id: str, user: Dict = Depends(get_current_user)):
    _ = user  # any login: passengers need leg prices before booking
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(trip_id)})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    view = await _split_view(db, trip)
    if not view["segmented"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, view["reason"])
    return view["segments"]


@router.get("/trips/{trip_id}/segments/summary")
async def trip_segments_summary(trip_id: str, user: Dict = Depends(get_current_user)):
    """Full picture for the driver console toggle + passenger breakdown."""
    _ = user
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(trip_id)})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    view = await _split_view(db, trip)
    view["trip"] = {"id": str(trip["_id"]),
                    "source_name": trip["source"]["name"],
                    "destination_name": trip["destination"]["name"],
                    "status": trip["status"]}
    return view


@router.post("/trips/{trip_id}/segments/rebuild")
async def rebuild_trip_segments(trip_id: str, user: Dict = Depends(get_current_user)):
    """Owner-only, idempotent: persist the live view into `segments` + rewrite
    every confirmed booking's cost_share to its segment total."""
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(trip_id)})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your trip")
    if trip.get("status") not in ("draft", "published", "ongoing"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "segments are frozen once a trip is completed/cancelled")
    count = await persist_segments(db, trip)
    return {"rebuilt": True, "segments": count, "trip_id": str(trip["_id"])}


async def persist_segments(db, trip: Dict) -> int:
    """Write live view into `segments` + bookings' cost_share. Returns legs.
    Single choke point for the endpoint AND the bookings.py join/leave hook.
    Trips without geometry fall back to Module 12's recalculate_trip_shares."""
    from app.api.v1.cost import recalculate_trip_shares

    view = await _split_view(db, trip)
    if not view["segmented"]:
        await recalculate_trip_shares(db, trip["_id"])
        return 0
    now = _utcnow()
    await db.segments.delete_many({"trip_id": trip["_id"]})
    docs = []
    for seg in view["segments"]:
        docs.append({
            "trip_id": trip["_id"],
            "seq": seg["seq"],
            "from_label": seg["from_label"],
            "to_label": seg["to_label"],
            "from_frac": seg["from_frac"],
            "to_frac": seg["to_frac"],
            "from_point": seg["from_point"],
            "to_point": seg["to_point"],
            "distance_km": seg["distance_km"],
            "leg_cost": seg["leg_cost"],
            "occupant_booking_ids": [ObjectId(bid) for bid in seg["occupant_ids"]],
            "shares": seg["shares"],
            "cost_per_occupant": seg["cost_per_occupant"],
            "created_at": now,
        })
    if docs:
        await db.segments.insert_many(docs)
    for bid, share in view["totals"].items():
        await db.bookings.update_one(
            {"_id": ObjectId(bid)}, {"$set": {"cost_share": share}})
    return len(docs)