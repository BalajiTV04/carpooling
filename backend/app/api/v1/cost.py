"""Cost endpoints (Module 12): driver pricing + live share breakdowns.

- POST /trips/{id}/pricing  owner sets price_policy on draft/published trips
  {mode: split_equal|per_seat|split_riders, fuel_price?: ₹/unit}.
- GET  /trips/{id}/cost     driver + passenger preview: fuel total, per-seat
  estimate, live distribution across confirmed bookings, and a "if you book
  now" projection for the caller.
- GET  /bookings/{id}/cost  one booking's breakdown with the formula inputs.

bookings.py calls recalculate_trip_shares() on confirm/reject/cancel so every
confirmed booking carries its `cost_share` (whole-trip version; Module 13
upgrades this to per-segment recalculation).
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.cost import (
    POLICY_MODES,
    distribute,
    passenger_share,
    resolve_fuel_price,
    total_fuel_cost,
)
from app.services.cost_sharing import (
    check_seats_left, compute_shares, CONFIRMED_STATUSES, get_fuel_unit,
    segment_table,
)

router = APIRouter(tags=["cost"])


class PricingIn(BaseModel):
    mode: str = Field(default="split_equal")
    fuel_price: Optional[float] = Field(default=None, ge=1, le=500)

    @field_validator("mode")
    @classmethod
    def mode_ok(cls, v: str) -> str:
        if v not in POLICY_MODES:
            raise ValueError("mode must be " + "|".join(POLICY_MODES))
        return v


def _oid(v: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(v)


async def _cost_context(db, trip: Dict) -> Dict:
    """Shared inputs: vehicle mileage, policy, fuel total."""
    veh = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
    policy = trip.get("price_policy") or {"mode": "split_equal"}
    fuel_price = resolve_fuel_price((veh or {}).get("fuel_type"), policy)
    fuel = total_fuel_cost(trip.get("distance_km"),
                           (veh or {}).get("mileage_kmpl"), fuel_price)
    return {
        "vehicle": {"id": str(trip["vehicle_id"]),
                    "make": (veh or {}).get("make"),
                    "model": (veh or {}).get("model"),
                    # Car identity rides along with the fuel maths so the UI can
                    # show WHICH car the mileage belongs to (year/plate/colour are
                    # display-only; they never affect the number).
                    "year": (veh or {}).get("year"),
                    "color": (veh or {}).get("color"),
                    "plate_no": (veh or {}).get("plate_no"),
                    "fuel_type": (veh or {}).get("fuel_type"),
                    "mileage_kmpl": (veh or {}).get("mileage_kmpl")},
        "policy": {"mode": policy.get("mode", "split_equal"),
                   "fuel_price": fuel_price},
        "fuel": fuel,
    }

@router.post("/trips/{trip_id}/pricing")
async def set_pricing(trip_id: str, body: PricingIn,
                      user: Dict = Depends(get_current_user)):
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(trip_id, "trip not found")})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your trip")
    if trip["status"] not in ("draft", "published"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "pricing is fixed once the trip is ongoing/completed")
    policy = {"mode": body.mode,
              "fuel_price": body.fuel_price,
              "set_at": datetime.now(timezone.utc)}
    await db.trips.update_one({"_id": trip["_id"]},
                              {"$set": {"price_policy": policy}})
    return {"pricing": {"mode": body.mode, "fuel_price": body.fuel_price}}


@router.get("/trips/{trip_id}/cost")
async def trip_cost(trip_id: str, user: Dict = Depends(get_current_user)):
    """Live cost picture: totals, per-seat estimate, confirmed distribution,
    and the caller's projected share if they booked one seat right now."""
    _ = user
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(trip_id, "trip not found")})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    ctx = await _cost_context(db, trip)
    mode = ctx["policy"]["mode"]
    total = ctx["fuel"]["total_cost"]
    seats_offered = int(trip.get("seats_offered", 1))

    confirmed_docs = await db.bookings.find(
        {"trip_id": trip["_id"],
         "status": {"$in": ["confirmed", "accepted"]}}).to_list(50)
    confirmed = [{"id": str(d["_id"]), "seats": int(d.get("seats", 1))}
                 for d in confirmed_docs]
    confirmed_seats = sum(c["seats"] for c in confirmed)
    shares = distribute(mode, total, seats_offered, confirmed)

    seats_left = seats_offered - int(trip.get("seats_booked", 0))
    projected = 0.0
    if seats_left > 0:
        projected = passenger_share(mode, total, seats_offered, 1,
                                    confirmed_seats + 1, len(confirmed) + 1)

    return {
        "trip": {"id": str(trip["_id"]),
                 "source_name": trip["source"]["name"],
                 "destination_name": trip["destination"]["name"],
                 "status": trip["status"],
                 "seats_offered": seats_offered,
                 "seats_left": seats_left},
        **ctx,
        "confirmed_seats": confirmed_seats,
        "passengers": len(confirmed),
        "shares": shares,
        "collected_total": round(sum(shares.values()), 2),
        "per_seat_estimate": (round(total / seats_offered, 2)
                              if seats_offered > 0 else 0.0),
        "projected_share_if_book_1_seat_now": projected,
        "note": "Fuel-only sharing, capped at trip cost — the driver never profits.",
    }


@router.get("/bookings/{booking_id}/cost")
async def booking_cost(booking_id: str, user: Dict = Depends(get_current_user)):
    db = get_db()
    booking = await db.bookings.find_one(
        {"_id": _oid(booking_id, "booking not found")})
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "booking not found")
    if user["id"] not in (str(booking["passenger_id"]), str(booking["driver_id"])):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your booking")
    trip = await db.trips.find_one({"_id": booking["trip_id"]})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    ctx = await _cost_context(db, trip)
    mode = ctx["policy"]["mode"]
    total = ctx["fuel"]["total_cost"]
    seats_offered = int(trip.get("seats_offered", 1))
    confirmed_docs = await db.bookings.find(
        {"trip_id": booking["trip_id"],
         "status": {"$in": ["confirmed", "accepted"]}}).to_list(50)
    confirmed = [{"id": str(d["_id"]), "seats": int(d.get("seats", 1))}
                 for d in confirmed_docs]
    confirmed_seats = sum(c["seats"] for c in confirmed)
    share = distribute(mode, total, seats_offered,
                       confirmed + [{"id": str(booking["_id"]),
                                     "seats": int(booking.get("seats", 1))}]
                       ).get(str(booking["_id"]), 0.0)
    return {
        "booking_id": str(booking["_id"]),
        "status": booking["status"],
        "seats": int(booking.get("seats", 1)),
        "mode": mode,
        "total_cost": total,
        "your_share": share,
        # Module 12's whole-trip arithmetic, exposed to the PASSENGER too.
        # Without these the rider sees "₹344.08" but nothing explains the
        # mileage/fuel price that produced it.
        "vehicle": ctx["vehicle"],
        "fuel": ctx["fuel"],
        "inputs": {"seats_offered": seats_offered,
                   "confirmed_seats": confirmed_seats,
                   "passengers": len(confirmed)},
        "formula": {
            "split_equal": "total / (1 + passengers)",
            "per_seat": "total × your seats / seats offered",
            "split_riders": "total × your seats / confirmed seats",
        }[mode],
    }


async def recalculate_trip_shares(db, trip_id: ObjectId) -> None:
    """Persist cost_share on every confirmed/accepted booking of the trip."""
    trip = await db.trips.find_one({"_id": trip_id})
    if trip is None:
        return
    ctx = await _cost_context(db, trip)
    confirmed_docs = await db.bookings.find(
        {"trip_id": trip_id, "status": {"$in": ["confirmed", "accepted"]}}).to_list(50)
    confirmed = [{"id": str(d["_id"]), "seats": int(d.get("seats", 1))}
                 for d in confirmed_docs]
    shares = distribute(ctx["policy"]["mode"], ctx["fuel"]["total_cost"],
                        int(trip.get("seats_offered", 1)), confirmed)
    for d in confirmed_docs:
        await db.bookings.update_one(
            {"_id": d["_id"]},
            {"$set": {"cost_share": shares.get(str(d["_id"]), 0.0)}})


# ---------------------------------------------------------------------------
# New segment-based cost endpoints (Module 12+)
# ---------------------------------------------------------------------------

class CostPreviewIn(BaseModel):
    trip_id: str
    pickup_along_km: float
    drop_along_km: float
    seats: int = Field(default=1, ge=1, le=7)


@router.post("/cost/preview")
async def cost_preview_endpoint(body: CostPreviewIn,
                                user: Dict = Depends(get_current_user)):
    """What this passenger would pay if they joined the currently accepted
    passengers on the trip. Also returns seats left for their range."""
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(body.trip_id, "trip not found")})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")

    route_km = float(trip.get("route_km") or trip.get("distance_km") or 0)
    mileage = trip.get("vehicle_mileage_kmpl")
    fuel_price = trip.get("fuel_price_per_unit") or trip.get("fuel_price")
    route_coords = (trip.get("route_geometry") or {}).get("coordinates")

    if (not mileage or not fuel_price) and trip.get("vehicle_id"):
        veh = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
        if veh:
            mileage = mileage or veh.get("mileage_kmpl")
            if not fuel_price:
                fuel_price = resolve_fuel_price(veh.get("fuel_type"),
                                                trip.get("price_policy"))

    if not mileage or not fuel_price or route_km <= 0:
        return {
            "estimated_contribution": None,
            "available": False,
            "reason": "Cost not available - driver has not set a fuel price",
            "seats_left": 0,
            "can_book": False,
        }

    mileage = float(mileage)
    fuel_price = float(fuel_price)

    cursor = db.bookings.find({
        "trip_id": trip["_id"],
        "status": {"$in": list(CONFIRMED_STATUSES)},
    })
    confirmed_docs = await cursor.to_list(100)

    p_seats = int(trip.get("passenger_seats") or trip.get("seats_offered") or 4)
    seats_left = check_seats_left(
        route_km, p_seats, confirmed_docs,
        body.pickup_along_km, body.drop_along_km, route_coords,
    )
    if seats_left < body.seats:
        return {
            "estimated_contribution": None,
            "available": False,
            "reason": "not enough seats left for this request",
            "seats_left": seats_left,
            "can_book": False,
        }

    candidate = {
        "_id": "preview_candidate",
        "seats": body.seats,
        "pickup_along_km": body.pickup_along_km,
        "drop_along_km": body.drop_along_km,
        "status": "accepted",
    }
    shares = compute_shares(
        route_km=route_km, mileage=mileage, fuel_price=fuel_price,
        bookings=confirmed_docs + [candidate],
        round_mode=get_settings().ROUND_MODE,
        route_coords=route_coords,
    )
    return {
        "estimated_contribution": shares["passengers"].get("preview_candidate", 0),
        "available": True,
        "seats_left": seats_left,
        "can_book": True,
        "total_cost": shares["total_cost"],
        "driver_share": shares["driver_share"],
        "passengers_count": len(confirmed_docs),
        "fuel_unit": get_fuel_unit(trip.get("fuel_type")),
    }


@router.get("/trips/{trip_id}/fare-breakdown")
async def fare_breakdown(trip_id: str, user: Dict = Depends(get_current_user)):
    """Segment-level fare breakdown for a trip.

    Driver sees every passenger's amount; a passenger sees the segment table
    and only their own amount.
    """
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(trip_id, "trip not found")})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")

    is_driver = str(trip.get("driver_id")) == user["id"]

    route_km = float(trip.get("route_km") or trip.get("distance_km") or 0)
    mileage = trip.get("vehicle_mileage_kmpl")
    fuel_price = trip.get("fuel_price_per_unit") or trip.get("fuel_price")
    route_coords = (trip.get("route_geometry") or {}).get("coordinates")

    if not mileage or not fuel_price or route_km <= 0:
        return {
            "available": False,
            "reason": "Cost not available - driver has not set a fuel price",
            "segments": [],
            "passengers": {},
            "driver_share": 0,
            "total_cost": 0,
        }

    mileage = float(mileage)
    fuel_price = float(fuel_price)

    cursor = db.bookings.find({
        "trip_id": trip["_id"],
        "status": {"$in": list(CONFIRMED_STATUSES)},
    })
    confirmed_docs = await cursor.to_list(100)

    result = compute_shares(
        route_km=route_km, mileage=mileage, fuel_price=fuel_price,
        bookings=confirmed_docs,
        round_mode=get_settings().ROUND_MODE,
        route_coords=route_coords,
    )

    segs = segment_table(
        route_km, mileage, fuel_price, confirmed_docs,
        round_mode=get_settings().ROUND_MODE, route_coords=route_coords,
    )

    passengers_out = {}
    for b in confirmed_docs:
        bid = str(b["_id"])
        amt = result["passengers"].get(bid, 0)
        entry = {"amount": amt}
        if is_driver:
            u = await db.users.find_one({"_id": b["passenger_id"]}, {"full_name": 1})
            entry["name"] = (u or {}).get("full_name") or "Passenger"
            entry["seats"] = int(b.get("seats", 1))
            entry["pickup_along_km"] = b.get("pickup_along_km")
            entry["drop_along_km"] = b.get("drop_along_km")
        passengers_out[bid] = entry

    p_seats = int(trip.get("passenger_seats") or trip.get("seats_offered") or 4)
    seats_left = check_seats_left(route_km, p_seats, confirmed_docs,
                                  0.0, route_km, route_coords)

    if is_driver:
        passengers_payload = passengers_out
    else:
        passengers_payload = {str(user["id"]):
                              result["passengers"].get(str(user["id"]), 0)}

    return {
        "available": True,
        "route_km": route_km,
        "fuel_unit": get_fuel_unit(trip.get("fuel_type")),
        "mileage_kmpl": mileage,
        "fuel_price_per_unit": fuel_price,
        "total_cost": result["total_cost"],
        "driver_share": result["driver_share"],
        "passengers_total": result["passengers_total"],
        "seats_left": seats_left,
        "segments": segs,
        "passengers": passengers_payload,
        "is_driver": is_driver,
    }