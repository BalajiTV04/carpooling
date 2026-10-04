"""Public geo API (Module 7): geocode search, reverse, route preview, refresh.

- GET /geo/search?q=&limit=      Nominatim forward (login required)
- GET /geo/reverse?lat=&lng=     click → name (login required)
- POST /geo/route {src, dst}     OSRM preview WITHOUT saving (for forms/maps)
- POST /trips/{id}/route/refresh re-route a draft/published trip (owner only)

Auth: search/reverse/route need any login (passengers use them in Module 8);
refresh needs the trip OWNER (driver). Rate courtesy: service caches 1h.
"""
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.v1.trips import _haversine_km, _out
from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.services.routing import nominatim_reverse, nominatim_search, osrm_route

router = APIRouter(prefix="/geo", tags=["geo"])
_trips = APIRouter(prefix="/trips", tags=["trips"])  # refresh endpoint annex
_driver = require_roles("driver")


class RouteReq(BaseModel):
    src: List[float] = Field(min_length=2, max_length=2)
    dst: List[float] = Field(min_length=2, max_length=2)


class PlaceHit(BaseModel):
    name: str
    address: Optional[str] = None
    lat: float
    lng: float


@router.get("/search", response_model=List[PlaceHit])
async def geo_search(
    q: str = Query(min_length=3, max_length=120),
    limit: int = Query(default=5, ge=1, le=8),
    user: dict = Depends(get_current_user),
):
    _ = user
    # Bias to the Bengaluru/Karnataka corridor (project demo state). The viewbox
    # is a RANKING bias, NOT a fence: bounded=1 used to hard-exclude Mandya,
    # Mysuru, Hubballi and the rest of the state from a Bengaluru-sized box, so
    # searching "Mandya" returned nothing. Biased-only keeps Bengaluru first.
    hits = await nominatim_search(q, limit=limit,
                                  viewbox=(74.9, 11.9, 78.1, 13.4),
                                  bounded=False)
    return hits


@router.get("/reverse", response_model=PlaceHit)
async def geo_reverse(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    user: dict = Depends(get_current_user),
):
    _ = user
    hit = await nominatim_reverse(lat, lng)
    if hit is None:
        # Offline fallback: still return coords so map clicks never break.
        return {"name": "Pinned point", "address": None, "lat": lat, "lng": lng}
    return hit


@router.post("/route")
async def geo_route(body: RouteReq, user: dict = Depends(get_current_user)):
    _ = user
    routed = await osrm_route(body.src, body.dst)
    if routed is None:
        # Fallback: straight line so the map still draws SOMETHING.
        dist = round(_haversine_km(body.src, body.dst), 2)
        return {"routed": False,
                "geometry": {"type": "LineString", "coordinates": [body.src, body.dst]},
                "distance_km": dist, "duration_min": None}
    return {"routed": True, **routed}


@_trips.post("/{trip_id}/route/refresh")
async def refresh_trip_route(trip_id: str, user: dict = Depends(_driver)):
    """Re-route an owned draft/published trip (after endpoint edits, or when
    the first attempt ran offline and route_geometry is still None)."""
    if not ObjectId.is_valid(trip_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": ObjectId(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] not in ("draft", "published"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only draft/published trips can re-route")
    from datetime import datetime, timezone

    src = doc["source"]["point"]["coordinates"]
    dst = doc["destination"]["point"]["coordinates"]
    routed = await osrm_route(src, dst)
    if routed is None:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "routing engine unreachable — try again later")
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"route_geometry": routed["geometry"],
                  "distance_km": routed["distance_km"],
                  "duration_min": routed["duration_min"],
                  "updated_at": datetime.now(timezone.utc)}},
        return_document=True)
    return {"routed": True, "trip": _out(updated)}
