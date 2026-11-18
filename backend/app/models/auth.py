"""Auth request/response shapes (Module 3 owns these; UserDoc stays in models).

Register takes phone + password + name + one-or-both roles. Login takes
phone + password. OTP verify takes phone + 6-digit code. /me returns the
public profile — never password_hash.
"""
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.common import PHONE_RE
from app.models.vehicle import FUELS, normalise_plate


class RegisterIn(BaseModel):
    phone: str
    email: Optional[str] = None
    password: str = Field(min_length=6, max_length=72)
    full_name: str = Field(min_length=2, max_length=80)
    roles: List[str] = Field(default_factory=lambda: ["passenger"])
    mileage: Optional[float] = Field(default=None, ge=1, le=60)
    available_seats: Optional[int] = Field(default=None, ge=1, le=7)
    # --- driver photo (URL-only, same doctrine as profile avatar) ---
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    # --- optional vehicle details captured at driver signup ---
    vehicle_make: Optional[str] = Field(default=None, max_length=40)
    vehicle_model: Optional[str] = Field(default=None, max_length=40)
    vehicle_year: Optional[int] = Field(default=None, ge=1985, le=2030)
    vehicle_color: Optional[str] = Field(default=None, max_length=30)
    vehicle_plate_no: Optional[str] = Field(default=None, min_length=4, max_length=15)
    vehicle_seats_total: Optional[int] = Field(default=None, ge=1, le=7)
    vehicle_fuel_type: Optional[str] = None
    vehicle_image_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("phone")
    @classmethod
    def phone_ok(cls, v: str) -> str:
        if not PHONE_RE.match(v):
            raise ValueError("phone must be E.164, e.g. +919876543210")
        return v

    @field_validator("roles")
    @classmethod
    def roles_ok(cls, v: List[str]) -> List[str]:
        allowed = {"driver", "passenger"}
        # admin is NEVER self-registered; seeded/promoted by an admin later.
        # Older API clients and integration tests can register a dual-role
        # account, while the current UI selects one role at a time.
        if not v or len(set(v)) != len(v) or any(role not in allowed for role in v):
            raise ValueError("roles must contain driver and/or passenger only")
        return v

    @field_validator("avatar_url")
    @classmethod
    def avatar_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("avatar_url must start with http(s)://")
        return v

    @field_validator("vehicle_image_url")
    @classmethod
    def vehicle_image_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("vehicle_image_url must start with http(s)://")
        return v

    @field_validator("vehicle_fuel_type")
    @classmethod
    def vehicle_fuel_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in FUELS:
            raise ValueError("fuel must be " + "/".join(FUELS))
        return v

    @field_validator("vehicle_plate_no")
    @classmethod
    def vehicle_plate_ok(cls, v: Optional[str]) -> Optional[str]:
        return normalise_plate(v) if v is not None else None


class LoginIn(BaseModel):
    phone: str
    email: Optional[str] = None
    password: str = Field(min_length=1)
    role: Optional[str] = None  # if provided, must match one of the account's roles


class OtpRequestIn(BaseModel):
    phone: str


class OtpVerifyIn(BaseModel):
    phone: str
    code: str = Field(min_length=6, max_length=6, pattern="^[0-9]{6}$")


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class MeOut(BaseModel):
    id: str
    phone: str
    email: Optional[str] = None
    full_name: str
    roles: List[str]
    phone_verified: bool
    avatar_url: Optional[str] = None
    mileage_kmpl: Optional[float] = None
    available_seats: Optional[int] = None


class OtpSentOut(BaseModel):
    sent: bool = True
    # DEV ONLY: real SMS would omit this. Returned so the project is testable
    # without a paid SMS provider; Module 23 (notifications) replaces transport.
    dev_code: Optional[str] = None
    expires_in_sec: int = 600
