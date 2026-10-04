"""Impact analytics (Module 24): sustainability, demand, and model evaluation.

- GET /analytics/impact       platform totals (km/CO2/cost saved, by fuel)
- GET /analytics/demand       shrunk (weekday, hour) forecast + time-split
                              MAE/RMSE backtest
- GET /analytics/evaluation   precision/recall/F1 + AUC for the Module 9 rule
                              score and the Module 16 AI score, head to head
- GET /analytics/me           the same impact maths scoped to MY rides
                              (open to any logged-in user — the demo surface)

All the arithmetic lives in `services/analytics.py`; this module only gathers
documents and shapes the response. The per-rider distance comes from the
Module 13 `segments` (which already record which bookings occupy each leg);
when segments are missing we fall back to the booking's own pickup→dropoff
distance on the SAME equirectangular ruler as Modules 9/10/13, and say so.

The first three routes are admin-only: they describe the whole platform, not
one user's riding.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.services.analytics import (
    backtest,
    demand_forecast,
    evaluation,
    sustainability,
)
from app.services.cost import resolve_fuel_price
from app.services.geo_math import haversine_km

router = APIRouter(prefix="/analytics", tags=["analytics"])
_admin = require_roles("admin")

MAX_TRIPS = 500
MAX_BOOKINGS = 3000
# Statuses that count as "this journey actually happened" for demand history.
HISTORY_STATUSES = ("published", "ongoing", "completed")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_list(coords) -> Optional[List[float]]:
    if isinstance(coords, (list, tuple)) and len(coords) == 2:
        try:
            return [float(coords[0]), float(coords[1])]
        except (TypeError, ValueError):
            return None
    return None


def _leg_km(booking: Dict) -> float:
    """Fallback rider distance: pickup -> dropoff on the shared ruler."""
    pickup = _as_list(((booking.get("pickup") or {}).get("point") or {}).get("coordinates"))
    drop = _as_list(((booking.get("dropoff") or {}).get("point") or {}).get("coordinates"))
    if pickup and drop:
        return round(haversine_km(pickup, drop), 2)
    return 0.0


async def _gather(db, query: Optional[Dict] = None) -> Dict:
    """Collect everything the pure maths needs for a set of completed trips."""
    trips = await db.trips.find(query or {"status": "completed"}).to_list(MAX_TRIPS)
    if not trips:
        return {"trips": [], "rides": [], "bookings": []}
    trip_ids = [t["_id"] for t in trips]
    vehicles = {}
    vids = [t["vehicle_id"] for t in trips if t.get("vehicle_id")]
    if vids:
        async for v in db.vehicles.find({"_id": {"$in": vids}}):
            vehicles[v["_id"]] = v

    bookings = await db.bookings.find({"trip_id": {"$in": trip_ids}}).to_list(MAX_BOOKINGS)
    segments = await db.segments.find({"trip_id": {"$in": trip_ids}}).to_list(MAX_BOOKINGS)
    by_booking: Dict[str, float] = {}
    leg_km: Dict[str, float] = {}
    for leg in segments:
        trip_key = str(leg.get("trip_id"))
        dist = float(leg.get("distance_km") or 0.0)
        leg_km[trip_key] = leg_km.get(trip_key, 0.0) + dist
        for oid in (leg.get("occupant_booking_ids") or []):
            key = str(oid)
            by_booking[key] = by_booking.get(key, 0.0) + dist
    grouped: Dict[str, List[Dict]] = {}
    for b in bookings:
        grouped.setdefault(str(b.get("trip_id")), []).append(b)

    rides = []
    for t in trips:
        key = str(t["_id"])
        veh = vehicles.get(t.get("vehicle_id"), {})
        policy = t.get("price_policy") or {}
        trip_bookings = grouped.get(key, [])
        riders = []
        for b in trip_bookings:
            if b.get("status") != "completed":
                continue
            bid = str(b["_id"])
            riders.append({
                "booking_id": bid,
                # segments are authoritative; the booking's own endpoints are
                # the documented fallback when they are missing
                "rider_km": round(by_booking.get(bid) or _leg_km(b), 2),
                "seats": int(b.get("seats", 1) or 1),
                "cost_share": float(b.get("cost_share") or 0.0),
            })
        actual = leg_km.get(key) or float(t.get("distance_km") or 0.0)
        rides.append({
            "trip_id": key,
            "fuel_type": veh.get("fuel_type"),
            "mileage_kmpl": policy.get("mileage_kmpl") or veh.get("mileage_kmpl"),
            "fuel_price": resolve_fuel_price(veh.get("fuel_type"), policy),
            "route_km": float(t.get("distance_km") or 0.0),
            "actual_km": actual,
            "detour_km": sum(float(b.get("detour_km") or 0.0) for b in trip_bookings),
            "riders": riders,
        })
    return {"trips": trips, "rides": rides, "bookings": bookings}


@router.get("/impact")
async def impact(user: Dict = Depends(_admin)):
    """Platform sustainability: what sharing actually saved, and where."""
    _ = user
    db = get_db()
    data = await _gather(db)
    out = sustainability(data["rides"])
    out["generated_at"] = _utcnow().isoformat()
    out["scope"] = "all completed trips (newest {} max)".format(MAX_TRIPS)
    return out


@router.get("/demand")
async def demand(user: Dict = Depends(_admin),
                 horizon_days: int = Query(default=14, ge=1, le=90),
                 buckets: bool = Query(default=False)):
    """Forecast demand per (weekday, hour) slot + a time-split MAE/RMSE."""
    _ = user
    db = get_db()
    trips = await db.trips.find(
        {"status": {"$in": list(HISTORY_STATUSES)}},
        {"depart_at": 1, "seats_offered": 1, "seats_booked": 1}).to_list(MAX_TRIPS)
    times = [t.get("depart_at") for t in trips if t.get("depart_at")]
    out = demand_forecast(times, horizon_days=horizon_days)
    out["backtest"] = backtest(times)
    out["history"] = {
        "trips": len(trips),
        "window_days": (len({t.date() for t in times}) if times else 0),
        "seats_offered": sum(int(t.get("seats_offered") or 0) for t in trips),
        "seats_booked": sum(int(t.get("seats_booked") or 0) for t in trips),
    }
    if not buckets:
        out.pop("buckets", None)  # 168 rows unless explicitly requested
    return out


@router.get("/evaluation")
async def model_evaluation(user: Dict = Depends(_admin)):
    """Did ranking correlate with rides happening? Rule score vs AI score."""
    _ = user
    db = get_db()
    bookings = await db.bookings.find(
        {"match_score": {"$ne": None}},
        {"match_score": 1, "ai_score": 1, "status": 1}).to_list(MAX_BOOKINGS)
    out = evaluation(bookings)
    out["generated_at"] = _utcnow().isoformat()
    return out


@router.get("/me")
async def my_impact(user: Dict = Depends(get_current_user)):
    """The same maths, scoped to rides I drove or rode. Open to everyone."""
    db = get_db()
    uid = ObjectId(user["id"])
    data = await _gather(db)
    mine_driven = {str(t["_id"]) for t in data["trips"]
                   if str(t.get("driver_id")) == user["id"]}
    mine_ridden = {str(b.get("trip_id")) for b in data["bookings"]
                   if str(b.get("passenger_id")) == user["id"]}
    as_driver = [r for r in data["rides"] if r["trip_id"] in mine_driven]
    as_rider = [r for r in data["rides"] if r["trip_id"] in mine_ridden]
    paid = 0.0
    earned = 0.0
    for r in as_rider:
        paid += sum(x["cost_share"] for x in r["riders"])
    for r in as_driver:
        earned += sum(x["cost_share"] for x in r["riders"])
    return {
        "trips_as_driver": len(as_driver),
        "trips_as_rider": len(as_rider),
        "as_driver": sustainability(as_driver),
        "as_rider": sustainability(as_rider),
        "paid_total": round(paid, 2),
        "collected_total": round(earned, 2),
        "net": round(earned - paid, 2),
        "note": "Driver figures are the platform impact of trips you offered; "
                "rider figures are the impact of rides you joined.",
    }

