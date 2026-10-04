"""Booking shapes (Module 11). Status machine:

    requested --driver accept--> accepted --passenger confirm--> confirmed
        |                            |                            |
        +--driver reject--> rejected +----any party-----> cancelled |
                             ^                          cancelled  |
                             |                                     v
    completion (Module 19) --requested auto-reject--> rejected   completed

Seats are RESERVED atomically at request time (Mongo conditional $inc) and
released on reject/cancel — no oversell between request and accept. At trip
completion seats FROZEN (never released) and confirmed/accepted rides settle.
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class BookingIn(BaseModel):
    trip_id: str
    seats: int = Field(default=1, ge=1, le=7)
    pickup_coordinates: List[float] = Field(min_length=2, max_length=2)
    dropoff_coordinates: List[float] = Field(min_length=2, max_length=2)
    use_optimised_pickup: bool = True  # Module 10 meeting point, else exact door

    @field_validator("pickup_coordinates", "dropoff_coordinates")
    @classmethod
    def coords_ok(cls, v: List[float]) -> List[float]:
        lng, lat = v
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError("coordinates must be [lng, lat] in range")
        return v


class BookingOut(BaseModel):
    id: str
    trip_id: str
    passenger_id: str
    driver_id: str
    seats: int
    status: str
    pickup: dict
    dropoff: dict
    pickup_distance_m: Optional[float] = None
    detour_km: Optional[float] = None
    overlap_pct: Optional[float] = None
    match_score: Optional[float] = None
    ai_score: Optional[float] = None
    ai_model: Optional[str] = None
    cost_share: Optional[float] = None  # Module 12 fills this
    closed_at: Optional[datetime] = None      # Module 19: trip-completion stamp
    closure_note: Optional[str] = None        # Module 19: e.g. "trip completed"
    created_at: Optional[datetime] = None
    trip: Optional[dict] = None
    passenger_name: Optional[str] = None
    driver_name: Optional[str] = None