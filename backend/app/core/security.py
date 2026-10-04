"""Auth crypto: password hashing + JWT + dev OTP.

Design choices (MCA-practical):
- Passwords: PBKDF2-SHA256 via passlib (pure-python, no C wheels, works on
  Python 3.8). Production can swap one line to bcrypt/argon2.
- JWT: HS256 via python-jose. Payload = {sub=user_id, phone, roles, exp}.
- OTP: 6-digit random, stored in `phone_otps` with 10-min TTL. Real SMS is a
  paid provider (Twilio/MSG91) — out of scope for the project, so /otp/request
  returns the code in the response (DEV ONLY, flagged in docs). The verify
  path is identical when you plug in a real sender later.
"""
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(user_id: str, phone: str, roles: List[str],
                        expires_min: Optional[int] = None) -> str:
    settings = get_settings()
    minutes = expires_min if expires_min is not None else settings.JWT_EXPIRE_MINUTES
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"sub": user_id, "phone": phone, "roles": roles, "exp": exp}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> Dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except JWTError as exc:
        raise ValueError("invalid or expired token") from exc


def generate_otp() -> str:
    # secrets-module would be ideal; random is fine for dev OTP demo.
    return "{:06d}".format(random.randint(0, 999999))


def otp_expiry(minutes: int = 10) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def dev_otp_enabled() -> bool:
    # Always True for this college project (no paid SMS). Viva line:
    # "OTP transport is stubbed; verification logic is production-shaped."
    return True
