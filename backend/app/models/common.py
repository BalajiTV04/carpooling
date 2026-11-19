"""Shared field types for all models (Py3.8-safe)."""
import re
from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

# E.164 India phone, e.g. +919876543210 (Module 3 login key)
PHONE_RE = re.compile(r"^\+91[0-9]{10}$")

# Canonical Indian mobile: 10 digits, starts with 6-9
MOBILE10_RE = re.compile(r"^[6-9][0-9]{9}$")


def normalize_phone(value: str) -> str:
    """Normalize a phone input to canonical +91 E.164 form.

    Accepts: 10 digits, "91"+10 digits, "+91"+10 digits, or a leading "0".
    Strips spaces and other non-digit characters.
    Returns "+91XXXXXXXXXX".
    Raises ValueError if the result is not a valid Indian mobile.
    """
    digits = re.sub(r"\D", "", value or "")
    # Drop country code / trunk prefix if present
    if digits.startswith("91") and len(digits) > 10:
        digits = digits[2:]
    elif digits.startswith("+91") and len(digits) > 13:
        digits = digits[3:]
    elif digits.startswith("0") and len(digits) > 10:
        digits = digits[1:]
    # Cut to 10 digits
    digits = digits[:10]
    if not MOBILE10_RE.match(digits):
        raise ValueError("Enter a valid 10-digit mobile number")
    return "+91" + digits


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
