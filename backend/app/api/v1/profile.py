"""Profile routes (Module 4): view/edit own profile, public view, role add,
password change. No DB migration — reuses the Module 2 users collection.

Endpoints (all under /api/v1):
- GET    /users/me            full own profile (private fields included)
- PATCH  /users/me            edit full_name/email/avatar only
- POST   /users/me/roles      add driver|passenger (driver needs verified phone)
- POST   /users/me/password   change password (checks current)
- GET    /users/{user_id}     public card (name/roles/rating/verified)

Rules: phone is immutable (it's the login key — changing it needs re-verify,
out of scope). Email unique when set (409 on clash). Ratings read-only here
(Module 22 writes them). Role removal is admin-only (Module 21).
"""
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import hash_password, verify_password
from app.models.profile import (
    AddRoleIn,
    ChangePasswordIn,
    ProfileOut,
    PublicProfileOut,
    UpdateProfileIn,
)

router = APIRouter(prefix="/users", tags=["profile"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _full(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "phone": doc["phone"],
        "email": doc.get("email"),
        "full_name": doc.get("full_name", ""),
        "roles": doc.get("roles", []),
        "avatar_url": doc.get("avatar_url"),
        "phone_verified": bool(doc.get("phone_verified", False)),
        "rating_avg": doc.get("rating_avg"),
        "rating_count": int(doc.get("rating_count", 0)),
        "status": doc.get("status", "active"),
        "created_at": doc.get("created_at"),
    }


def _public(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "full_name": doc.get("full_name", ""),
        "roles": doc.get("roles", []),
        "avatar_url": doc.get("avatar_url"),
        "phone_verified": bool(doc.get("phone_verified", False)),
        "rating_avg": doc.get("rating_avg"),
        "rating_count": int(doc.get("rating_count", 0)),
    }


@router.get("/me", response_model=ProfileOut)
async def get_my_profile(user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.users.find_one({"_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    return _full(doc)


@router.patch("/me", response_model=ProfileOut)
async def update_my_profile(body: UpdateProfileIn, user: dict = Depends(get_current_user)):
    db = get_db()
    patch = {}
    if body.full_name is not None:
        patch["full_name"] = body.full_name.strip()
    if body.email is not None:  # None clears; string sets (lowercased by validator)
        patch["email"] = body.email
    if body.avatar_url is not None:
        patch["avatar_url"] = body.avatar_url
    if not patch:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nothing to update")
    patch["updated_at"] = _utcnow()
    try:
        doc = await db.users.find_one_and_update(
            {"_id": ObjectId(user["id"])}, {"$set": patch}, return_document=True
        )
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already in use")
    return _full(doc)


@router.post("/me/roles", response_model=ProfileOut)
async def add_my_role(body: AddRoleIn, user: dict = Depends(get_current_user)):
    """Upgrade passenger→driver (or vice versa) without re-registering.

    Driver role requires a verified phone (safety: passengers must be able to
    reach the driver on trip day). Module 6 will additionally require a
    verified vehicle before publishing.
    """
    db = get_db()
    if body.role in user.get("roles", []):
        raise HTTPException(status.HTTP_409_CONFLICT, "role already held")
    if body.role == "driver" and not user.get("phone_verified"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "verify phone before becoming a driver")
    doc = await db.users.find_one_and_update(
        {"_id": ObjectId(user["id"])},
        {"$addToSet": {"roles": body.role}, "$set": {"updated_at": _utcnow()}},
        return_document=True,
    )
    return _full(doc)


@router.post("/me/password")
async def change_my_password(body: ChangePasswordIn, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.users.find_one({"_id": ObjectId(user["id"])})
    if doc is None or not verify_password(body.current_password, doc.get("password_hash", "")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "current password is wrong")
    await db.users.update_one(
        {"_id": ObjectId(user["id"])},
        {"$set": {"password_hash": hash_password(body.new_password), "updated_at": _utcnow()}},
    )
    return {"changed": True}


@router.get("/{user_id}", response_model=PublicProfileOut)
async def get_public_profile(user_id: str, user: dict = Depends(get_current_user)):
    """Any logged-in user can see another's public card (needed for trip
    listings: passenger checks driver name/rating before booking)."""
    _ = user  # session required, identity unused beyond the gate
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    db = get_db()
    doc = await db.users.find_one({"_id": ObjectId(user_id), "status": "active"})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return _public(doc)
