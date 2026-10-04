"""Shared field types for all models (Py3.8-safe)."""
import re
from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

# E.164 phone, e.g. +919876543210 (Module 3 login key)
PHONE_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GeoPoint(BaseModel):
    """GeoJSON Point. Coordinates ALWAYS [lng, lat] — Mongo order."""

    type: str = Field(default="Point", pattern="^Point$")
    coordinates: List[float] = Field(min_length=2, max_length=2)

    @field_validator("coordinates")
    @classmethod
    def check_ranges(cls, v: List[float]) -> List[float]:
        lng, lat = v
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError("coordinates out of range (want [lng, lat])")
        return v


class PlaceRef(BaseModel):
    name: str
    address: Optional[str] = None
    point: GeoPoint
