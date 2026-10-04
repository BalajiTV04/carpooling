"""Auth routes: register / login / OTP request+verify / me.

Flow:
1. POST /auth/register {phone, password, full_name, roles} -> user + JWT.
   New accounts start phone_verified=False.
2. POST /auth/otp/request {phone} -> dev OTP (10-min TTL, single-use).
3. POST /auth/otp/verify {phone, code} -> phone_verified=True (+ JWT refresh).
4. POST /auth/login {phone, password} -> JWT (rejects suspended accounts).
5. GET /auth/me (Bearer) -> public profile.

Security notes: duplicate phone -> 409 (same for email when provided).
Wrong password -> 401 (never reveal whether the phone exists... in practice
we 404 unknown phones on login to keep UX sane for a college demo — flagged
in docs). OTP brute force: attempts counter, locked after 5 tries.
"""
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    dev_otp_enabled,
    generate_otp,
    hash_password,
    otp_expiry,
    verify_password,
)
from app.models.auth import (
    LoginIn,
    MeOut,
    OtpRequestIn,
    OtpSentOut,
    OtpVerifyIn,
    RegisterIn,
    TokenOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _public_user(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "phone": doc["phone"],
        "full_name": doc.get("full_name", ""),
        "roles": doc.get("roles", []),
        "phone_verified": bool(doc.get("phone_verified", False)),
    }


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn):
    db = get_db()
    now = _utcnow()
    doc = {
        "phone": body.phone,
        "password_hash": hash_password(body.password),
        "full_name": body.full_name.strip(),
        "roles": body.roles,
        "phone_verified": False,
        "rating_avg": None,
        "rating_count": 0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    try:
        res = await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already registered")
    created = await db.users.find_one({"_id": res.inserted_id})
    user = _public_user(created)
    token = create_access_token(user["id"], user["phone"], user["roles"])
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn):
    db = get_db()
    user = await db.users.find_one({"phone": body.phone})
    if user is None or not user.get("password_hash"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    if user.get("status") != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account suspended")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong password")
    public = _public_user(user)
    token = create_access_token(public["id"], public["phone"], public["roles"])
    return {"access_token": token, "token_type": "bearer", "user": public}


@router.post("/otp/request", response_model=OtpSentOut)
async def otp_request(body: OtpRequestIn):
    db = get_db()
    user = await db.users.find_one({"phone": body.phone})
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    code = generate_otp()
    await db.phone_otps.update_one(
        {"phone": body.phone},
        {"$set": {"code": code, "expires_at": otp_expiry(),
                  "attempts": 0, "created_at": _utcnow()}},
        upsert=True,
    )
    # DEV ONLY: echo the code. A real sender (Twilio/MSG91) would go here.
    return {"sent": True,
            "dev_code": code if dev_otp_enabled() else None,
            "expires_in_sec": 600}


@router.post("/otp/verify", response_model=TokenOut)
async def otp_verify(body: OtpVerifyIn):
    db = get_db()
    rec = await db.phone_otps.find_one({"phone": body.phone})
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no OTP requested")
    if rec.get("attempts", 0) >= 5:
        await db.phone_otps.delete_one({"phone": body.phone})
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many attempts, request a new code")
    exp = rec.get("expires_at")
    if exp is not None:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < _utcnow():
            await db.phone_otps.delete_one({"phone": body.phone})
            raise HTTPException(status.HTTP_410_GONE, "code expired")
    if rec.get("code") != body.code:
        await db.phone_otps.update_one({"phone": body.phone}, {"$inc": {"attempts": 1}})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong code")
    # Single-use: delete BEFORE updating user so a replay can't double-verify.
    await db.phone_otps.delete_one({"phone": body.phone})
    user = await db.users.find_one_and_update(
        {"phone": body.phone},
        {"$set": {"phone_verified": True, "updated_at": _utcnow()}},
        return_document=True,
    )
    public = _public_user(user)
    token = create_access_token(public["id"], public["phone"], public["roles"])
    return {"access_token": token, "token_type": "bearer", "user": public}


@router.get("/me", response_model=MeOut)
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/logout")
async def logout():
    # Stateless JWT: server keeps no session, so logout = client discards token.
    # (Refresh-token rotation would arrive here if the project needed it.)
    return {"logged_out": True}
