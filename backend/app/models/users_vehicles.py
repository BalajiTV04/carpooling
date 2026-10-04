"""users + vehicles documents (Modules 3-5 own the routes; Module 2 owns shape)."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.common import PHONE_RE, utcnow


class UserDoc(BaseModel):
    phone: str
    email: Optional[str] = None
    password_hash: Optional[str] = None
    full_name: str = Field(min_length=2)
    roles: List[str]
    avatar_url: Optional[str] = None
    phone_verified: bool = False
    rating_avg: Optional[float] = Field(default=None, ge=0, le=5)
    rating_count: int = 0
    status: str = "active"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @field_validator("phone")
    @classmethod
    def phone_e164(cls, v: str) -> str:
        if not PHONE_RE.match(v):
            raise ValueError("phone must be E.164, e.g. +919876543210")
        return v

    @field_validator("roles")
    @classmethod
    def roles_known(cls, v: List[str]) -> List[str]:
        allowed = {"driver", "passenger", "admin"}
        if not v or any(r not in allowed for r in v):
            raise ValueError("roles must be 1+ of driver/passenger/admin")
        return v


class VehicleDoc(BaseModel):
    owner_id: str  # ObjectId str; validated to ObjectId at route layer
    make: str
    model: str
    year: Optional[int] = None
    color: Optional[str] = None
    plate_no: str  # normalised UPPER-no-space by route layer
    seats_total: int = Field(ge=1, le=7)
    fuel_type: str
    mileage_kmpl: Optional[float] = None
    image_url: Optional[str] = None  # URL-only; see models/vehicle.py
    verification_status: str = "pending"
    verification_note: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @field_validator("fuel_type")
    @classmethod
    def fuel_known(cls, v: str) -> str:
        if v not in ("petrol", "diesel", "cng", "ev", "hybrid"):
            raise ValueError("unknown fuel_type")
        return v
