"""Trip shapes (Module 6). Coordinates manual until Module 7 geocoding.

- PlaceIn: name + [lng, lat] (GeoJSON order, range-checked).
- TripIn: vehicle_id + source/dest + depart_at (UTC ISO) + seats_offered.
- TripUpdateIn: edit draft/published (depart_at, seats, places).
- TripOut: API shape with seats_left computed.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.common import GeoPoint


class PlaceIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    address: Optional[str] = Field(default=None, max_length=200)
    coordinates: List[float] = Field(min_length=2, max_length=2)

    @field_validator("coordinates")
    @classmethod
    def coords_ok(cls, v: List[float]) -> List[float]:
        lng, lat = v
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError("coordinates must be [lng, lat] in range")
        return v

    def to_place(self) -> dict:
        return {"name": self.name.strip(),
                "address": self.address,
                "point": GeoPoint(coordinates=self.coordinates).model_dump()}


class TripIn(BaseModel):
    vehicle_id: str
    source: PlaceIn
    destination: PlaceIn
    depart_at: datetime
    seats_offered: int = Field(ge=1, le=7)
    # Module 14: how far ahead passengers may book, and how late they may cancel
    # the plan; omitted -> Settings defaults.
    advance_policy: Optional[Dict] = None

    @field_validator("depart_at")
    @classmethod
    def future_only(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        if v <= datetime.now(timezone.utc):
            raise ValueError("depart_at must be in the future")
        return v


class TripUpdateIn(BaseModel):
    source: Optional[PlaceIn] = None
    destination: Optional[PlaceIn] = None
    depart_at: Optional[datetime] = None
    seats_offered: Optional[int] = Field(default=None, ge=1, le=7)

    @field_validator("depart_at")
    @classmethod
    def future_only(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is None:
            return None
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        if v <= datetime.now(timezone.utc):
            raise ValueError("depart_at must be in the future")
        return v


class TripOut(BaseModel):
    id: str
    source_name: str
    destination_name: str
    source: dict
    destination: dict
    depart_at: datetime
    seats_offered: int
    seats_booked: int
    seats_left: int
    vehicle_id: str
    status: str
    distance_km: Optional[float] = None
    duration_min: Optional[float] = None
    booking_opens_at: Optional[str] = None   # Module 14 derived window
    booking_closes_at: Optional[str] = None
    advance_policy: Optional[dict] = None
    recurring_group_id: Optional[str] = None  # Module 15 series tag
    created_at: Optional[datetime] = None
