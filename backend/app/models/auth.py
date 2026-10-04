"""Auth request/response shapes (Module 3 owns these; UserDoc stays in models).

Register takes phone + password + name + one-or-both roles. Login takes
phone + password. OTP verify takes phone + 6-digit code. /me returns the
public profile — never password_hash.
"""
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.common import PHONE_RE


class RegisterIn(BaseModel):
    phone: str
    password: str = Field(min_length=6, max_length=72)
    full_name: str = Field(min_length=2, max_length=80)
    roles: List[str] = Field(default_factory=lambda: ["passenger"])

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
        if not v or any(r not in allowed for r in v):
            raise ValueError("roles must be driver and/or passenger")
        return sorted(set(v))


class LoginIn(BaseModel):
    phone: str
    password: str = Field(min_length=1)


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
    full_name: str
    roles: List[str]
    phone_verified: bool


class OtpSentOut(BaseModel):
    sent: bool = True
    # DEV ONLY: real SMS would omit this. Returned so the project is testable
    # without a paid SMS provider; Module 23 (notifications) replaces transport.
    dev_code: Optional[str] = None
    expires_in_sec: int = 600
