"""Minimum-detour ride search endpoint.

POST /api/v1/rides/search-with-detour

Body:
  source {lat, lng, address}
  destination {lat, lng, address}
  date (YYYY-MM-DD)
  time (HH:MM) optional
  seats (int, default 1)

For every published trip that day we run the detour optimiser
(app/services/detour.py) and return feasible matches enriched with driver,
vehicle, seats and the estimated travel contribution.

Reuses existing modules only: detour service, cost engine, geo/routing client,
Mongo via get_db(). No duplicate code.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.cost import compute_detour_contribution
from app.services.detour import (
    DetourConfig,
    evaluate_detour,
)

router = APIRouter(tags=["detour"])


class PlaceIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: Optional[str] = None


class SearchWithDetourIn(BaseModel):
    source: PlaceIn
    destination: PlaceIn
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    seats: int = Field(default=1, ge=1, le=7)

    @field_validator("date")
    @classmethod
    def date_ok(cls, v: str) -> str:
        datetime.strptime(v, "%Y-%m-%d")
        return v


def _to_lnglat(p: PlaceIn) -> List[float]:
    return [p.lng, p.lat]


@router.post("/rides/search-with-detour")
async def search_with_detour(
    body: SearchWithDetourIn,
    user: Dict = Depends(get_current_user),
):
    db = get_db()
    seats = int(body.seats)

    wanted_dt: Optional[datetime] = None
    if body.time:
        hh, mm = map(int, body.time.split(":"))
        base = datetime.strptime(body.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        wanted_dt = base.replace(hour=hh, minute=mm, second=0, microsecond=0)

    day_start = datetime.strptime(body.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    day_end = day_start.replace(hour=23, minute=59, second=59)

    src = _to_lnglat(body.source)
    dst = _to_lnglat(body.destination)

    cur = db.trips.find({
        "status": "published",
        "depart_at": {"$gte": day_start, "$lte": day_end},
    }).sort("depart_at", 1).limit(200)

    config = DetourConfig.from_settings()
    results: List[Dict] = []

    async for doc in cur:
        left = int(doc.get("seats_offered", 0)) - int(doc.get("seats_booked", 0))
        if left < seats:
            continue

        res = await evaluate_detour(
            trip_doc=doc,
            src=src,
            dst=dst,
            seats_needed=seats,
            wanted_dt=wanted_dt,
            config=config,
        )
        if not res.feasible:
            continue

        driver = await db.users.find_one(
            {"_id": doc["driver_id"]},
            {"full_name": 1, "phone": 1},
        )
        veh = await db.vehicles.find_one({"_id": doc["vehicle_id"]})
        mileage = float((veh or {}).get("mileage_kmpl") or 15.0)

        depart_at = doc.get("depart_at")
        tdiff_min = None
        if wanted_dt is not None and depart_at is not None:
            if depart_at.tzinfo is None:
                depart_at = depart_at.replace(tzinfo=timezone.utc)
            tdiff_min = abs((depart_at - wanted_dt).total_seconds()) / 60.0

        occupants = 1 + seats
        cost = compute_detour_contribution(
            passenger_distance_km=res.passenger_distance_km,
            detour_km=res.detour_km,
            mileage_kmpl=mileage,
            fuel_price_per_litre=config.fuel_price_per_litre,
            occupants=occupants,
            policy=config.cost_split_policy,
            include_detour_cost=config.include_detour_cost,
        )

        pickup_pt = res.pickup.point
        drop_pt = res.drop.point

        results.append({
            "trip_id": str(doc["_id"]),
            "driver_name": (driver or {}).get("full_name") or "Driver",
            "vehicle": {
                "make": (veh or {}).get("make"),
                "model": (veh or {}).get("model"),
                "plate_no": (veh or {}).get("plate_no"),
                "fuel_type": (veh or {}).get("fuel_type"),
                "mileage_kmpl": (veh or {}).get("mileage_kmpl"),
            },
            "seats_available": left,
            "departure_time": doc["depart_at"].isoformat(),
            "pickup_point": {
                "lat": pickup_pt[1],
                "lng": pickup_pt[0],
                "address": body.source.address,
            },
            "drop_point": {
                "lat": drop_pt[1],
                "lng": drop_pt[0],
                "address": body.destination.address,
            },
            "walk_distance_km": res.walk_distance_km,
            "detour_km": res.detour_km,
            "extra_time_min": res.extra_time_min,
            "passenger_distance_km": res.passenger_distance_km,
            "estimated_contribution": cost["estimated_contribution"],
            "estimated": res.estimated,
            "route_overlap_percent": res.route_overlap_percent,
            "driver_route_polyline": [
                [p[1], p[0]] for p in res.driver_route_polyline
            ],
            "passenger_segment_polyline": [
                [p[1], p[0]] for p in res.passenger_segment_polyline
            ],
            "_sort": [res.detour_km, res.walk_distance_km,
                      tdiff_min if tdiff_min is not None else 9999.0],
        })

    results.sort(key=lambda r: r["_sort"])
    for r in results:
        del r["_sort"]

    return {
        "count": len(results),
        "date": body.date,
        "source": body.source.model_dump(),
        "destination": body.destination.model_dump(),
        "results": results,
    }
