"""Pickup-point optimisation API (Module 10) + route geometry for maps.

- POST /trips/{id}/pickup-options  → ranked meeting points for a passenger
  request (walk vs door vs auto). Any logged-in user may call it: the passenger
  exploring a trip, or the driver sanity-checking a request.
- GET  /trips/{id}/route          → simplified LineString for map rendering
  (Modules 9/10/17 all need this; keeps full geometry server-side).

Nothing is persisted here — the passenger's CHOICE is stored on the booking in
Module 11 (`booking.pickup` + `detour_km` + `pickup_distance_m`).
"""
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.geo_math import simplify
from app.services.pickup import optimise_pickup_point
from app.services.routing import nominatim_reverse

router = APIRouter(prefix="/trips", tags=["pickup"])


class PickupOptionsIn(BaseModel):
    pickup_coordinates: List[float] = Field(min_length=2, max_length=2)
    dropoff_coordinates: List[float] = Field(min_length=2, max_length=2)
    mode: str = Field(default="auto", pattern="^(auto|walk|door)$")
    max_walk_km: float = Field(default=1.5, ge=0.2, le=5.0)
    step_km: float = Field(default=0.4, ge=0.1, le=2.0)
    walk_weight: float = Field(default=0.3, ge=0.0, le=1.0)
    label_places: bool = True

    @field_validator("pickup_coordinates", "dropoff_coordinates")
    @classmethod
    def coords_ok(cls, v: List[float]) -> List[float]:
        lng, lat = v
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError("coordinates must be [lng, lat] in range")
        return v


def _oid(trip_id: str) -> ObjectId:
    if not ObjectId.is_valid(trip_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    return ObjectId(trip_id)


async def _load_trip(db, trip_id: str, allow_statuses=None) -> Dict:
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if allow_statuses and doc.get("status") not in allow_statuses:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "trip status " + str(doc.get("status")) + " has no live route")
    return doc


@router.post("/{trip_id}/pickup-options")
async def pickup_options(trip_id: str, body: PickupOptionsIn,
                         user: Dict = Depends(get_current_user)):
    _ = user
    db = get_db()
    doc = await _load_trip(db, trip_id, allow_statuses=("draft", "published", "ongoing"))
    coords = (doc.get("route_geometry") or {}).get("coordinates")
    result = optimise_pickup_point(
        coords or [],
        body.pickup_coordinates,
        body.dropoff_coordinates,
        mode=body.mode,
        max_walk_km=body.max_walk_km,
        step_km=body.step_km,
        walk_weight=body.walk_weight,
    )
    # Friendly names via reverse geocoding (cached, best-effort, 2 calls max).
    if body.label_places and result.get("chosen"):
        for slot in [result["chosen"]] + list(result.get("alternates") or []):
            if slot.get("label"):
                continue
            lng, lat = slot["coordinates"]
            hit = await nominatim_reverse(lat, lng)
            slot["label"] = (hit or {}).get("name") or "On-route point"
    result["trip"] = {
        "id": str(doc["_id"]),
        "source_name": doc["source"]["name"],
        "destination_name": doc["destination"]["name"],
        "distance_km": doc.get("distance_km"),
        "routed": bool(coords),
    }
    return result


@router.get("/{trip_id}/route")
async def trip_route_for_map(
    trip_id: str,
    max_points: int = Query(default=200, ge=10, le=1000),
    user: Dict = Depends(get_current_user),
):
    """Simplified route geometry for Leaflet (drawer maps, Module 17 tracking)."""
    _ = user
    db = get_db()
    doc = await _load_trip(db, trip_id)
    coords = (doc.get("route_geometry") or {}).get("coordinates") or []
    simplified = simplify(coords, max_points) if coords else []
    return {
        "trip_id": str(doc["_id"]),
        "routed": bool(coords),
        "distance_km": doc.get("distance_km"),
        "duration_min": doc.get("duration_min"),
        "source": doc["source"],
        "destination": doc["destination"],
        "geometry": {"type": "LineString", "coordinates": simplified},
        "original_points": len(coords),
        "returned_points": len(simplified),
    }