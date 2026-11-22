"""Fuel-based segment cost sharing with live recalculation engine.

PRICING FORMULA:
  fuel_used = segment_km / mileage_kmpl
  segment_cost = fuel_used * fuel_price_per_unit
  Split each route segment equally among everyone in the vehicle on that segment.
  The driver is ALWAYS counted as one person.
  A segment is a stretch between two consecutive breakpoints, where breakpoints
  are 0, the route end, and every confirmed passenger's pickup and drop along_km.
  Passenger amount = sum of their share over the segments they ride.
  Driver's remaining amount = total route cost minus the sum of the passengers' rounded amounts.
  Rounding: integer paise or Decimal (no floats). Round each passenger's TOTAL UP
  to the next whole rupee (ROUND_MODE=CEIL default; also HALF_UP and NONE).
  The driver keeps the remainder so driver + passengers = exact total. Never negative.

WORKED EXAMPLES:
  Route 100 km, mileage 20, fuel Rs 100/litre (total Rs 500):
   1. A rides 0-100 alone: A = 250, driver = 250.
   2. A 0-100 and B 20-100: segment 0-20 = Rs 100 split 2 -> 50 each;
      segment 20-100 = Rs 400 split 3 -> 133.33 each.
      A = 50 + 133.33 = 183.33 -> 184, B = 133.33 -> 134,
      driver = 500 - 184 - 134 = 182.
   3. Add C 40-100: segments 0-20 (Rs 100 / 2 = 50),
      20-40 (Rs 100 / 3 = 33.33), 40-100 (Rs 300 / 4 = 75).
      A = 159, B = 109, C = 75, driver = 157.
   4. Cancel B in case 2: A returns to 250 (and driver 250).
  Route 105 km, mileage 20, fuel Rs 100/litre (5.25 L = Rs 525):
   5. A alone: A = 263, driver = 262.
"""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
import math
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId

from app.core.config import get_settings
from app.services.geo_math import point_at_km, project_onto_route, route_length_km

EPS_KM = 1e-4  # 10 cm tolerance for breakpoint deduplication and segment coverage
CONFIRMED_STATUSES = ("accepted", "confirmed", "completed")


def get_fuel_unit(fuel_type: Optional[str]) -> str:
    """Label fuel unit by fuel type: litre for petrol/diesel, kg for CNG, kWh for EV."""
    ft = (fuel_type or "petrol").lower().strip()
    if ft in ("petrol", "diesel", "hybrid"):
        return "L"
    elif ft == "cng":
        return "kg"
    elif ft == "ev":
        return "kWh"
    return "unit"


def _extract_along_km(
    booking: Dict,
    route_km: float,
    route_coords: Optional[List[List[float]]] = None,
) -> Tuple[float, float]:
    """Extract (pickup_along_km, drop_along_km) from booking, or project coords."""
    p_along = booking.get("pickup_along_km")
    d_along = booking.get("drop_along_km")

    if p_along is None:
        p_along = booking.get("pickup", {}).get("along_km")
    if p_along is None:
        p_along = booking.get("match_explain", {}).get("pickup", {}).get("along_km")

    if d_along is None:
        d_along = booking.get("dropoff", {}).get("along_km")
    if d_along is None:
        d_along = booking.get("drop", {}).get("along_km")
    if d_along is None:
        d_along = booking.get("match_explain", {}).get("drop", {}).get("along_km")

    # If missing and geometry available, project onto route
    if (p_along is None or d_along is None) and route_coords and len(route_coords) >= 2:
        if p_along is None:
            p_pt = booking.get("pickup", {}).get("point", {}).get("coordinates")
            if not p_pt:
                p_pt = booking.get("pickup_coordinates")
            if p_pt:
                proj = project_onto_route(p_pt, route_coords)
                p_along = float(proj["frac"]) * float(route_km)

        if d_along is None:
            d_pt = booking.get("dropoff", {}).get("point", {}).get("coordinates")
            if not d_pt:
                d_pt = booking.get("dropoff_coordinates")
            if d_pt:
                proj = project_onto_route(d_pt, route_coords)
                d_along = float(proj["frac"]) * float(route_km)

    # Fallback to passenger_distance_km if still missing
    p_dist = booking.get("passenger_distance_km")
    if p_along is None:
        p_along = 0.0
    if d_along is None:
        d_along = float(p_along) + float(p_dist) if p_dist else float(route_km)

    p_val = max(0.0, min(float(route_km), float(p_along)))
    d_val = max(0.0, min(float(route_km), float(d_along)))
    if d_val <= p_val:
        d_val = min(float(route_km), p_val + (float(p_dist) if p_dist else 1.0))

    return round(p_val, 4), round(d_val, 4)


def breakpoints(
    route_km: float,
    bookings: List[Dict],
    route_coords: Optional[List[List[float]]] = None,
) -> List[float]:
    """Return sorted unique breakpoint positions along the driver's route."""
    r_km = float(route_km)
    raw = [0.0, r_km]
    for b in bookings:
        status = b.get("status")
        if status and status not in CONFIRMED_STATUSES:
            continue
        p_along, d_along = _extract_along_km(b, r_km, route_coords)
        if 0.0 <= p_along <= r_km:
            raw.append(p_along)
        if 0.0 <= d_along <= r_km:
            raw.append(d_along)

    raw.sort()
    deduped = [raw[0]]
    for pt in raw[1:]:
        if pt - deduped[-1] > EPS_KM:
            deduped.append(pt)
    if abs(deduped[-1] - r_km) > EPS_KM:
        deduped.append(r_km)
    return deduped


def segment_table(
    route_km: float,
    mileage: float,
    fuel_price: float,
    bookings: List[Dict],
    round_mode: str = "CEIL",
    route_coords: Optional[List[List[float]]] = None,
) -> List[Dict]:
    """Build the segment breakdown table along the driver's route."""
    if mileage is None or float(mileage) <= 0:
        raise ValueError("Vehicle mileage must be greater than 0")
    if fuel_price is None or float(fuel_price) <= 0:
        raise ValueError("Fuel price must be greater than 0")

    r_km = float(route_km)
    pts = breakpoints(r_km, bookings, route_coords)

    # Filter confirmed bookings
    confirmed = []
    for b in bookings:
        st = b.get("status")
        if st and st not in CONFIRMED_STATUSES:
            continue
        p_along, d_along = _extract_along_km(b, r_km, route_coords)
        bid = str(b.get("_id") or b.get("id") or id(b))
        confirmed.append({
            "id": bid,
            "seats": int(b.get("seats", 1)),
            "p_along": p_along,
            "d_along": d_along,
            "raw": b,
        })

    d_mileage = Decimal(str(mileage))
    d_fuel_price = Decimal(str(fuel_price))

    segments = []
    for i in range(len(pts) - 1):
        seg_start = pts[i]
        seg_end = pts[i + 1]
        seg_km = seg_end - seg_start
        if seg_km <= EPS_KM:
            continue

        # Find passengers who ride on this segment
        occupants = [
            c for c in confirmed
            if c["p_along"] <= seg_start + EPS_KM and c["d_along"] >= seg_end - EPS_KM
        ]
        # Driver is ALWAYS counted as 1 person. Each booked seat adds 1 occupant.
        passenger_seats = sum(c["seats"] for c in occupants)
        total_occupants = 1 + passenger_seats

        d_seg_km = Decimal(str(round(seg_km, 6)))
        d_fuel_used = d_seg_km / d_mileage
        d_seg_cost = d_fuel_used * d_fuel_price
        d_per_person = d_seg_cost / Decimal(str(total_occupants))

        shares: Dict[str, float] = {}
        for c in occupants:
            shares[c["id"]] = float(d_per_person * Decimal(str(c["seats"])))

        segments.append({
            "seq": len(segments),
            "from_km": round(seg_start, 2),
            "to_km": round(seg_end, 2),
            "km": round(seg_km, 2),
            "litres": float(round(d_fuel_used, 3)),
            "fuel_used": float(round(d_fuel_used, 4)),
            "cost": float(round(d_seg_cost, 2)),
            "occupants": total_occupants,
            "per_person": float(round(d_per_person, 2)),
            "occupant_booking_ids": [c["id"] for c in occupants],
            "shares": {k: round(v, 2) for k, v in shares.items()},
        })

    return segments


def compute_shares(
    route_km: float,
    mileage: float,
    fuel_price: float,
    bookings: List[Dict],
    round_mode: str = "CEIL",
    route_coords: Optional[List[List[float]]] = None,
    other_expenses_total: float = 0.0,
) -> Dict:
    """Compute fuel-based cost shares across all route segments, including other expenses.

    Returns:
      {
        "segments": [...],
        "passengers": {booking_id: amount},
        "driver_share": int or float,
        "total_cost": int or float,
        "passengers_total": int or float,
      }
    """
    if mileage is None or float(mileage) <= 0:
        raise ValueError("Vehicle mileage must be greater than 0")
    if fuel_price is None or float(fuel_price) <= 0:
        raise ValueError("Fuel price must be greater than 0")

    r_km = float(route_km)
    if r_km <= 0:
        return {
            "segments": [],
            "passengers": {},
            "driver_share": 0,
            "total_cost": 0,
            "passengers_total": 0,
        }

    d_route_km = Decimal(str(r_km))
    d_mileage = Decimal(str(mileage))
    d_fuel_price = Decimal(str(fuel_price))
    d_other_expenses = Decimal(str(round(float(other_expenses_total or 0.0), 2)))
    d_total_fuel = d_route_km / d_mileage
    d_total_cost = (d_total_fuel * d_fuel_price) + d_other_expenses

    pts = breakpoints(r_km, bookings, route_coords)

    # Filter confirmed bookings
    confirmed = []
    for b in bookings:
        st = b.get("status")
        if st and st not in CONFIRMED_STATUSES:
            continue
        p_along, d_along = _extract_along_km(b, r_km, route_coords)
        bid = str(b.get("_id") or b.get("id") or id(b))
        confirmed.append({
            "id": bid,
            "seats": int(b.get("seats", 1)),
            "p_along": p_along,
            "d_along": d_along,
            "raw": b,
        })

    segments = []
    pax_unrounded: Dict[str, Decimal] = {c["id"]: Decimal('0') for c in confirmed}

    for i in range(len(pts) - 1):
        seg_start = pts[i]
        seg_end = pts[i + 1]
        seg_km = seg_end - seg_start
        if seg_km <= EPS_KM:
            continue

        occupants = [
            c for c in confirmed
            if c["p_along"] <= seg_start + EPS_KM and c["d_along"] >= seg_end - EPS_KM
        ]
        passenger_seats = sum(c["seats"] for c in occupants)
        total_occupants = 1 + passenger_seats

        d_seg_km = Decimal(str(round(seg_km, 6)))
        d_fuel_used = d_seg_km / d_mileage
        d_seg_fuel_cost = d_fuel_used * d_fuel_price
        d_seg_other = (d_seg_km / d_route_km) * d_other_expenses if d_route_km > 0 else Decimal('0')
        d_seg_cost = d_seg_fuel_cost + d_seg_other
        d_per_person = d_seg_cost / Decimal(str(total_occupants))

        seg_shares: Dict[str, float] = {}
        for c in occupants:
            share = d_per_person * Decimal(str(c["seats"]))
            pax_unrounded[c["id"]] += share
            seg_shares[c["id"]] = float(share)

        segments.append({
            "seq": len(segments),
            "from_km": round(seg_start, 2),
            "to_km": round(seg_end, 2),
            "km": round(seg_km, 2),
            "litres": float(round(d_fuel_used, 3)),
            "fuel_used": float(round(d_fuel_used, 4)),
            "cost": float(round(d_seg_cost, 2)),
            "occupants": total_occupants,
            "per_person": float(round(d_per_person, 2)),
            "occupant_booking_ids": [c["id"] for c in occupants],
            "shares": {k: round(v, 2) for k, v in seg_shares.items()},
        })

    mode = str(round_mode or "CEIL").upper()
    pax_rounded: Dict[str, Any] = {}
    for bid, unrounded in pax_unrounded.items():
        if mode == "CEIL":
            pax_rounded[bid] = int(unrounded.to_integral_value(rounding=ROUND_CEILING))
        elif mode == "HALF_UP":
            pax_rounded[bid] = int(unrounded.to_integral_value(rounding=ROUND_HALF_UP))
        else:  # NONE
            pax_rounded[bid] = float(unrounded.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))

    if mode in ("CEIL", "HALF_UP"):
        total_cost_val = int(d_total_cost.to_integral_value(rounding=ROUND_HALF_UP))
        passengers_total = sum(pax_rounded.values())
        driver_share = max(0, total_cost_val - passengers_total)
    else:
        total_cost_val = float(d_total_cost.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
        passengers_total = round(sum(pax_rounded.values()), 2)
        driver_share = round(max(0.0, total_cost_val - passengers_total), 2)

    return {
        "segments": segments,
        "passengers": pax_rounded,
        "driver_share": driver_share,
        "total_cost": total_cost_val,
        "passengers_total": passengers_total,
    }


def check_seats_left(
    route_km: float,
    passenger_seats: int,
    confirmed_bookings: List[Dict],
    req_pickup_km: float,
    req_drop_km: float,
    route_coords: Optional[List[List[float]]] = None,
) -> int:
    """Calculate seats left strictly across [req_pickup_km, req_drop_km].

    A seat is consumed only on the segments where a passenger rides.
    seats_left = passenger_seats - max occupancy of confirmed bookings across that range.
    """
    p_seats = max(1, int(passenger_seats))
    r_km = float(route_km)
    p_req = max(0.0, min(r_km, float(req_pickup_km)))
    d_req = max(0.0, min(r_km, float(req_drop_km)))
    if d_req <= p_req:
        d_req = min(r_km, p_req + 1.0)

    # Filter confirmed bookings
    confirmed = []
    for b in confirmed_bookings:
        st = b.get("status")
        if st and st not in CONFIRMED_STATUSES:
            continue
        p_along, d_along = _extract_along_km(b, r_km, route_coords)
        confirmed.append({
            "seats": int(b.get("seats", 1)),
            "p_along": p_along,
            "d_along": d_along,
        })

    # Breakpoints inside the requested range
    pts = [p_req, d_req]
    for c in confirmed:
        if p_req < c["p_along"] < d_req:
            pts.append(c["p_along"])
        if p_req < c["d_along"] < d_req:
            pts.append(c["d_along"])
    pts = sorted(list(set(pts)))

    max_occupancy = 0
    for i in range(len(pts) - 1):
        s_lo, s_hi = pts[i], pts[i + 1]
        if s_hi - s_lo <= EPS_KM:
            continue
        occ = sum(
            c["seats"] for c in confirmed
            if c["p_along"] <= s_lo + EPS_KM and c["d_along"] >= s_hi - EPS_KM
        )
        if occ > max_occupancy:
            max_occupancy = occ

    return max(0, p_seats - max_occupancy)


async def cost_preview(
    trip: Dict,
    pickup_along_km: float,
    drop_along_km: float,
    requested_seats: int = 1,
    db: Any = None,
) -> Dict:
    """Preview what a new passenger would pay if they joined currently ACCEPTED passengers."""
    settings = get_settings()
    route_km = float(trip.get("route_km") or trip.get("distance_km") or 10.0)
    mileage = trip.get("vehicle_mileage_kmpl")
    fuel_price = trip.get("fuel_price_per_unit") or trip.get("fuel_price")

    if (not mileage or not fuel_price) and db is not None:
        if trip.get("vehicle_id"):
            veh = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
            if veh:
                mileage = mileage or veh.get("mileage_kmpl")
                if not fuel_price:
                    from app.services.cost import resolve_fuel_price
                    fuel_price = resolve_fuel_price(veh.get("fuel_type"), trip.get("price_policy"))

    if not mileage or not fuel_price:
        return {
            "estimated_contribution": None,
            "available": False,
            "reason": "Cost not available - driver has not set a fuel price",
            "seats_left": 0,
        }

    mileage = float(mileage)
    fuel_price = float(fuel_price)

    # Load confirmed bookings
    confirmed_docs: List[Dict] = []
    if db is not None:
        cursor = db.bookings.find({
            "trip_id": trip["_id"],
            "status": {"$in": list(CONFIRMED_STATUSES)},
        })
        confirmed_docs = await cursor.to_list(100)

    # Vehicle capacity
    p_seats = int(trip.get("passenger_seats") or trip.get("seats_offered") or 4)

    route_coords = (trip.get("route_geometry") or {}).get("coordinates")
    seats_left = check_seats_left(
        route_km, p_seats, confirmed_docs, pickup_along_km, drop_along_km, route_coords
    )

    # Add virtual candidate booking
    candidate = {
        "_id": "preview_candidate",
        "seats": int(requested_seats),
        "pickup_along_km": float(pickup_along_km),
        "drop_along_km": float(drop_along_km),
        "status": "accepted",
    }
    other_expenses_total = float(trip.get("other_expenses_total") or 0.0)
    shares = compute_shares(
        route_km=route_km,
        mileage=mileage,
        fuel_price=fuel_price,
        bookings=confirmed_docs + [candidate],
        round_mode=settings.ROUND_MODE,
        route_coords=route_coords,
        other_expenses_total=other_expenses_total,
    )

    candidate_amount = shares["passengers"].get("preview_candidate", 0)
    return {
        "estimated_contribution": candidate_amount,
        "seats_left": seats_left,
        "can_book": seats_left >= requested_seats,
        "total_cost": shares["total_cost"],
        "driver_share": shares["driver_share"],
        "passengers_count": len(confirmed_docs),
        "fuel_unit": get_fuel_unit(trip.get("fuel_type")),
    }


async def recompute_trip_fares(
    db: Any,
    trip_id: Any,
    reason: str = "recalculation",
) -> Dict:
    """Recalculate shares for confirmed passengers and write history + cost_summary.

    Idempotent with a version-checked update.
    """
    settings = get_settings()
    oid = ObjectId(str(trip_id))
    trip = await db.trips.find_one({"_id": oid})
    if not trip:
        return {}

    # Resolve fuel and vehicle parameters
    route_km = float(trip.get("route_km") or trip.get("distance_km") or 10.0)
    mileage = trip.get("vehicle_mileage_kmpl")
    fuel_price = trip.get("fuel_price_per_unit") or trip.get("fuel_price")
    veh = None
    if trip.get("vehicle_id"):
        veh = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
        if veh:
            mileage = mileage or veh.get("mileage_kmpl")
            if not fuel_price:
                from app.services.cost import resolve_fuel_price
                fuel_price = resolve_fuel_price(veh.get("fuel_type"), trip.get("price_policy"))

    if not mileage or not fuel_price:
        return {}

    mileage = float(mileage)
    fuel_price = float(fuel_price)
    route_coords = (trip.get("route_geometry") or {}).get("coordinates")

    # Fetch currently confirmed bookings
    cursor = db.bookings.find({
        "trip_id": oid,
        "status": {"$in": list(CONFIRMED_STATUSES)},
    }).sort("created_at", 1)
    bookings = await cursor.to_list(100)

    other_expenses_total = float(trip.get("other_expenses_total") or 0.0)
    # Compute shares
    result = compute_shares(
        route_km=route_km,
        mileage=mileage,
        fuel_price=fuel_price,
        bookings=bookings,
        round_mode=settings.ROUND_MODE,
        route_coords=route_coords,
        other_expenses_total=other_expenses_total,
    )

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # Update each confirmed booking with its newly calculated share
    for b in bookings:
        bid = str(b["_id"])
        new_amt = result["passengers"].get(bid, 0)
        prev_amt = b.get("estimated_contribution")
        if prev_amt is None:
            prev_amt = b.get("cost_share")

        update_set: Dict[str, Any] = {
            "estimated_contribution": new_amt,
            "cost_share": new_amt,
            "amount": new_amt,
            "updated_at": now,
        }
        if trip.get("status") == "completed":
            update_set["final_contribution"] = new_amt

        # Check if amount changed
        if prev_amt is not None and abs(float(prev_amt) - float(new_amt)) > 0.001:
            history_entry = {
                "amount": new_amt,
                "previous_amount": prev_amt,
                "reason": reason,
                "occupants": len(bookings) + 1,
                "at": now_iso,
            }
            update_set["fare_changed"] = True
            update_set["previous_amount"] = prev_amt
            await db.bookings.update_one(
                {"_id": b["_id"]},
                {
                    "$set": update_set,
                    "$push": {"fare_history": history_entry},
                },
            )
        else:
            await db.bookings.update_one(
                {"_id": b["_id"]},
                {"$set": update_set},
            )

    # Compute seats_left across the whole trip
    p_seats = int(trip.get("passenger_seats") or trip.get("seats_offered") or 4)
    trip_seats_left = check_seats_left(
        route_km, p_seats, bookings, 0.0, route_km, route_coords
    )

    # Version-checked cost summary
    current_version = int((trip.get("cost_summary") or {}).get("version", 0) or 0)
    new_version = current_version + 1
    cost_summary = {
        "total_cost": result["total_cost"],
        "driver_share": result["driver_share"],
        "passengers_total": result["passengers_total"],
        "seats_left": trip_seats_left,
        "version": new_version,
        "updated_at": now_iso,
    }

    await db.trips.update_one(
        {"_id": oid},
        {
            "$set": {
                "cost_summary": cost_summary,
                "total_cost": result["total_cost"],
                "cost_per_seat": result["driver_share"],
                "seats_left": trip_seats_left,
                "updated_at": now,
            }
        },
    )

    # Persist segments in db.segments collection
    await db.segments.delete_many({"trip_id": oid})
    seg_docs = []
    src_pt = (trip.get("source") or {}).get("point") or {"type": "Point", "coordinates": [0.0, 0.0]}
    dst_pt = (trip.get("destination") or {}).get("point") or {"type": "Point", "coordinates": [0.0, 0.0]}
    src_label = (trip.get("source") or {}).get("name") or "Start"
    dst_label = (trip.get("destination") or {}).get("name") or "End"
    route_coords = (trip.get("route_geometry") or {}).get("coordinates") or []

    for s in result["segments"]:
        p_lo = point_at_km(route_coords, s["from_km"]) if route_coords else None
        p_hi = point_at_km(route_coords, s["to_km"]) if route_coords else None
        from_pt = {"type": "Point", "coordinates": [round(p_lo[0], 6), round(p_lo[1], 6)]} if p_lo else src_pt
        to_pt = {"type": "Point", "coordinates": [round(p_hi[0], 6), round(p_hi[1], 6)]} if p_hi else dst_pt

        seg_docs.append({
            "trip_id": oid,
            "seq": s["seq"],
            "from_label": src_label if s["seq"] == 0 else f"km {s['from_km']:.1f}",
            "to_label": dst_label if s["seq"] == len(result["segments"]) - 1 else f"km {s['to_km']:.1f}",
            "from_point": from_pt,
            "to_point": to_pt,
            "from_km": s["from_km"],
            "to_km": s["to_km"],
            "distance_km": s["km"],
            "litres": s["litres"],
            "leg_cost": s["cost"],
            "occupants": s["occupants"],
            "cost_per_occupant": s["per_person"],
            "occupant_booking_ids": [ObjectId(bid) for bid in s["occupant_booking_ids"] if ObjectId.is_valid(bid)],
            "shares": s["shares"],
            "created_at": now,
        })
    if seg_docs:
        await db.segments.insert_many(seg_docs)

    return result
