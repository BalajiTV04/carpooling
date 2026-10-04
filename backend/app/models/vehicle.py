"""Vehicle shapes (Module 5). Plate is normalised UPPER-no-space everywhere.

- VehicleIn: create payload. seats_total = PASSENGER seats (driver excluded).
- VehicleUpdateIn: edit payload (plate change allowed but re-checks unique).
- VehicleOut: API shape (owner_id as string, verification badge fields).
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

FUELS = ("petrol", "diesel", "cng", "ev", "hybrid")


def normalise_plate(raw: str) -> str:
    """KA 05 mn 1234 -> KA05MN1234. One canonical form kills dup-by-spacing."""
    return "".join(raw.upper().split())


def sane_image_url(v: Optional[str]) -> Optional[str]:
    """URL-only vehicle photos (same doctrine as the profile: NO file upload,
    keeps MCA scope sane — hot-link any https image).

    Blank clears (returns None so the route writes an explicit null instead of
    skipping the key), and only http(s):// is accepted so a stored javascript:
    or data: URL can never execute when another user renders this card.
    """
    if v is None:
        return None
    v = v.strip()
    if v == "":
        return None  # empty string clears the photo
    if not (v.startswith("http://") or v.startswith("https://")):
        raise ValueError("image_url must start with http(s)://")
    return v


class VehicleIn(BaseModel):
    make: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=40)
    year: Optional[int] = Field(default=None, ge=1985, le=2030)
    color: Optional[str] = Field(default=None, max_length=30)
    plate_no: str = Field(min_length=4, max_length=15)
    seats_total: int = Field(ge=1, le=7)
    fuel_type: str
    mileage_kmpl: Optional[float] = Field(default=None, ge=1, le=60)
    image_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("image_url")
    @classmethod
    def image_ok(cls, v: Optional[str]) -> Optional[str]:
        return sane_image_url(v)

    @field_validator("fuel_type")
    @classmethod
    def fuel_ok(cls, v: str) -> str:
        if v not in FUELS:
            raise ValueError("fuel must be " + "/".join(FUELS))
        return v

    @field_validator("plate_no")
    @classmethod
    def plate_ok(cls, v: str) -> str:
        v = normalise_plate(v)
        if len(v) < 4:
            raise ValueError("plate too short")
        return v


class VehicleUpdateIn(BaseModel):
    make: Optional[str] = Field(default=None, min_length=1, max_length=40)
    model: Optional[str] = Field(default=None, min_length=1, max_length=40)
    year: Optional[int] = Field(default=None, ge=1985, le=2030)
    color: Optional[str] = Field(default=None, max_length=30)
    plate_no: Optional[str] = Field(default=None, min_length=4, max_length=15)
    seats_total: Optional[int] = Field(default=None, ge=1, le=7)
    fuel_type: Optional[str] = None
    mileage_kmpl: Optional[float] = Field(default=None, ge=1, le=60)
    is_active: Optional[bool] = None
    image_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("image_url")
    @classmethod
    def image_ok(cls, v: Optional[str]) -> Optional[str]:
        return sane_image_url(v)

    @field_validator("fuel_type")
    @classmethod
    def fuel_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in FUELS:
            raise ValueError("fuel must be " + "/".join(FUELS))
        return v

    @field_validator("plate_no")
    @classmethod
    def plate_ok(cls, v: Optional[str]) -> Optional[str]:
        return normalise_plate(v) if v is not None else None


class VehicleOut(BaseModel):
    id: str
    make: str
    model: str
    year: Optional[int] = None
    color: Optional[str] = None
    plate_no: str
    seats_total: int
    fuel_type: str
    mileage_kmpl: Optional[float] = None
    verification_status: str
    is_active: bool
    image_url: Optional[str] = None
    trips_as_vehicle: int = 0  # filled on detail (Module 6 counts usage)
    created_at: Optional[datetime] = None
