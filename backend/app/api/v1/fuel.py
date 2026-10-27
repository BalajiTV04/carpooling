"""Fuel price + distance estimation (supports driver & passenger dashboards).

- GET  /fuel/price        today's petrol / diesel / CNG rate (from Settings)
- GET  /fuel/distance     haversine distance + fare estimate between two points
                          (lat,lng pairs). Used before creating any plan so the
                          driver/passenger sees the km and cost up front.

No auth required for the price table (public reference data); distance needs a
session since it's tied to a rider's search.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import get_settings
from app.core.deps import get_optional_user
from app.services.cost import resolve_fuel_price, total_fuel_cost
from app.services.geo_math import haversine_km

router = APIRouter(prefix="/fuel", tags=["fuel"])

_DEFAULT_MILEAGE = 14.0  # km/l fallback when the vehicle's mileage is unknown


def _utcnow_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@router.get("/price")
async def fuel_price():
    """Current reference fuel prices (₹/litre)."""
    settings = get_settings()
    return {
        "petrol": settings.FUEL_PRICE_PETROL,
        "diesel": settings.FUEL_PRICE_DIESEL,
        "cng": settings.FUEL_PRICE_CNG,
        "ev": settings.FUEL_PRICE_EV,
        "hybrid": settings.FUEL_PRICE_HYBRID,
        "updated_at": _utcnow_iso(),
    }


@router.get("/distance")
async def fuel_distance(
    from_lat: float = Query(..., description="From latitude"),
    from_lng: float = Query(..., description="From longitude"),
    to_lat: float = Query(..., description="To latitude"),
    to_lng: float = Query(..., description="To longitude"),
    fuel_type: Optional[str] = Query(default="petrol"),
    mileage_kmpl: Optional[float] = Query(default=None),
    seats: int = Query(default=1, ge=1, le=7),
    user: dict = Depends(get_optional_user),
):
    """Distance + fare estimate between two points.

    Haversine on the shared equirectangular ruler (same as Modules 9/10/13) so
    the number a driver sees before publishing matches what a passenger sees
    while searching.
    """
    _ = user  # session optional; endpoint stays usable while browsing
    if not (-90 <= from_lat <= 90 and -90 <= to_lat <= 90):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "latitude must be between -90 and 90")
    if not (-180 <= from_lng <= 180 and -180 <= to_lng <= 180):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "longitude must be between -180 and 180")

    distance_km = round(haversine_km([from_lng, from_lat], [to_lng, to_lat]), 2)
    price = resolve_fuel_price(fuel_type, None)
    cost = total_fuel_cost(distance_km, mileage_kmpl, price)

    # Equal split among (driver + passengers) — driver's slice not collected.
    n_passengers = max(seats - 1, 0)
    per_passenger = round(cost["total_cost"] / (1 + n_passengers), 2) if n_passengers else 0.0

    return {
        "distance_km": distance_km,
        "fuel_type": fuel_type,
        "fuel_price_per_litre": price,
        "mileage_kmpl": cost["mileage_kmpl"],
        "estimated_fuel_cost": cost["total_cost"],
        "cost_per_km": cost["per_km"],
        "seats": seats,
        "per_passenger_share": per_passenger,
        "note": "Estimate only — the settled share is frozen when the ride completes.",
    }
