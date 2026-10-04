"""Profile shapes (Module 4). Auth owns identity; this owns the person.

- ProfileOut: full own profile (private fields like email included).
- PublicProfileOut: what other users may see (name, roles, rating, verified).
- UpdateProfileIn: only editable fields — phone/roles/verified/ratings are
  NEVER edited here (roles have their own endpoint with verification gate).
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class ProfileOut(BaseModel):
    id: str
    phone: str
    email: Optional[str] = None
    full_name: str
    roles: List[str]
    avatar_url: Optional[str] = None
    phone_verified: bool
    rating_avg: Optional[float] = None
    rating_count: int = 0
    status: str
    created_at: Optional[datetime] = None


class PublicProfileOut(BaseModel):
    id: str
    full_name: str
    roles: List[str]
    avatar_url: Optional[str] = None
    phone_verified: bool
    rating_avg: Optional[float] = None
    rating_count: int = 0


class UpdateProfileIn(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    email: Optional[str] = Field(default=None, max_length=120)
    avatar_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("email")
    @classmethod
    def email_sane(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip().lower()
        if v == "":
            return None  # empty string clears the email
        if "@" not in v or "." not in v or " " in v:
            raise ValueError("invalid email")
        return v

    @field_validator("avatar_url")
    @classmethod
    def avatar_sane(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None  # empty string clears the avatar
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("avatar_url must start with http(s)://")
        return v


class AddRoleIn(BaseModel):
    role: str = Field(pattern="^(driver|passenger)$")


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=72)
