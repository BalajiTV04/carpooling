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

from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.cost import (
    POLICY_MODES,
    distribute,
    passenger_share,
    resolve_fuel_price,
    total_fuel_cost,
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