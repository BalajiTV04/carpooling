"""Search shapes (Module 8 retrieval + Module 9 ranking knobs).

Knobs (all optional): max_pickup_km 3 (feasibility gate), max_detour_km 5
(soft dropoff factor), min_overlap_pct 20 (feasibility gate),
include_excluded false (transparency list with reasons).
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class SearchIn(BaseModel):
    src_coordinates: List[float] = Field(min_length=2, max_length=2)
    dst_coordinates: List[float] = Field(min_length=2, max_length=2)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    seats: int = Field(default=1, ge=1, le=7)
    radius_km: float = Field(default=8.0, ge=0.5, le=50.0)
    limit: int = Field(default=20, ge=1, le=50)
    max_pickup_km: float = Field(default=3.0, ge=0.5, le=20.0)
    max_detour_km: float = Field(default=5.0, ge=0.5, le=30.0)
    min_overlap_pct: float = Field(default=20.0, ge=0.0, le=90.0)
    include_excluded: bool = False

    @field_validator("src_coordinates", "dst_coordinates")
    @classmethod
    def coords_ok(cls, v: List[float]) -> List[float]:
        lng, lat = v
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError("coordinates must be [lng, lat] in range")
        return v

    def day_bounds_utc(self):
        """Return (day_start, day_end) UTC datetimes for the requested date."""
        from datetime import timezone

        start = datetime.strptime(self.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end = datetime.strptime(self.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        from datetime import timedelta

        end = end + timedelta(days=1)
        return start, end
