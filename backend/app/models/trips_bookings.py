"""trips + bookings + segments documents (routes in Modules 6/11/13)."""
from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.common import GeoPoint, PlaceRef, utcnow


class RouteLine(BaseModel):
    type: str = "LineString"
    coordinates: List[List[float]]


class TripDoc(BaseModel):
    driver_id: str
    vehicle_id: str
    source: PlaceRef
    destination: PlaceRef
    route_geometry: Optional[RouteLine] = None  # Module 7 fills via OSRM
    distance_km: Optional[float] = Field(default=None, ge=0)
    duration_min: Optional[float] = Field(default=None, ge=0)
    depart_at: datetime  # UTC
    seats_offered: int = Field(ge=1, le=7)
    seats_booked: int = Field(default=0, ge=0)
    price_policy: Optional[Dict] = None  # Module 12
    recurring: Optional[Dict] = None  # Module 15
    status: str = "draft"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class PickupRef(BaseModel):
    name: Optional[str] = None
    point: GeoPoint


class BookingDoc(BaseModel):
    trip_id: str
    passenger_id: str
    seats: int = Field(ge=1, le=7)
    pickup: PickupRef
    dropoff: PickupRef
    pickup_distance_m: Optional[float] = None  # Module 10
    detour_km: Optional[float] = None  # Module 10
    overlap_pct: Optional[float] = Field(default=None, ge=0, le=100)  # Module 9
    match_score: Optional[float] = Field(default=None, ge=0, le=100)  # Module 16
    ai_score: Optional[float] = Field(default=None, ge=0, le=100)  # Module 16
    ai_model: Optional[str] = None  # Module 16: logreg | rule-fallback
    match_explain: Optional[Dict] = None
    cost_share: Optional[float] = Field(default=None, ge=0)  # Module 12/13
    status: str = "requested"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class SegmentDoc(BaseModel):
    trip_id: str
    seq: int = Field(ge=0)
    from_label: str
    to_label: str
    from_point: GeoPoint
    to_point: GeoPoint
    distance_km: float = Field(ge=0)
    occupant_booking_ids: List[str] = Field(default_factory=list)
    cost_per_occupant: Optional[float] = None  # Module 13
    created_at: datetime = Field(default_factory=utcnow)
