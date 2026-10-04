"""Segment shape (Module 13): legs with occupants + per-occupant price."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class SegmentOut(BaseModel):
    trip_id: str
    seq: int
    from_label: str
    to_label: str
    from_frac: float
    to_frac: float
    distance_km: float
    leg_cost: float
    occupant_booking_ids: List[str] = Field(default_factory=list)
    occupant_names: List[str] = Field(default_factory=list)
    cost_per_occupant: float
    created_at: Optional[datetime] = None