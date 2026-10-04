"""Vehicle routes (Module 5): driver-only CRUD + admin verification.

Ownership: owner_id = creator; every query filters by owner. Plates globally
unique (normalised) — 409 on clash. Verification: pending -> verified|rejected
(admin only). Module 6 refuses non-verified vehicles at publish.
"""
from datetime import datetime, timezone
from typing import Dict, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pymongo.errors import DuplicateKeyError

from app.core.database import get_db
from app.core.deps import require_roles
from app.models.vehicle import VehicleIn, VehicleOut, VehicleUpdateIn, normalise_plate

router = APIRouter(prefix="/vehicles", tags=["vehicles"])
_driver = require_roles("driver")
_admin = require_roles("admin")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _out(doc: Dict, trips_as_vehicle: int = 0) -> Dict:
    return {
        "id": str(doc["_id"]),
        "make": doc["make"],
        "model": doc["model"],
        "year": doc.get("year"),
        "color": doc.get("color"),
        "plate_no": doc["plate_no"],
        "seats_total": doc["seats_total"],
        "fuel_type": doc["fuel_type"],
        "mileage_kmpl": doc.get("mileage_kmpl"),
        "image_url": doc.get("image_url"),
        "verification_status": doc.get("verification_status", "pending"),
        "is_active": bool(doc.get("is_active", True)),
        "trips_as_vehicle": trips_as_vehicle,
        "created_at": doc.get("created_at"),
    }


def _oid(v: str) -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    return ObjectId(v)


@router.post("", response_model=VehicleOut, status_code=201)
async def create_vehicle(body: VehicleIn, user: Dict = Depends(_driver)):
    db = get_db()
    now = _utcnow()
    doc = {
        "owner_id": ObjectId(user["id"]),
        "make": body.make.strip(),
        "model": body.model.strip(),
        "year": body.year,
        "color": body.color.strip() if body.color else None,
        "plate_no": body.plate_no,
        "seats_total": body.seats_total,
        "fuel_type": body.fuel_type,
        "mileage_kmpl": body.mileage_kmpl,
        "image_url": body.image_url,
        "verification_status": "pending",
        "verification_note": None,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    try:
        res = await db.vehicles.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "plate number already registered")
    created = await db.vehicles.find_one({"_id": res.inserted_id})
    return _out(created)


@router.get("", response_model=List[VehicleOut])
async def list_my_vehicles(
    user: Dict = Depends(_driver),
    include_inactive: bool = Query(default=False),
):
    db = get_db()
    q = {"owner_id": ObjectId(user["id"])}  # type: Dict
    if not include_inactive:
        q["is_active"] = True
    cur = db.vehicles.find(q).sort("created_at", -1)
    return [_out(d) async for d in cur]



@router.get("/{vehicle_id}", response_model=VehicleOut)
async def get_vehicle(vehicle_id: str, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.vehicles.find_one(
        {"_id": _oid(vehicle_id), "owner_id": ObjectId(user["id"])}
    )
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    trips = await db.trips.count_documents({"vehicle_id": doc["_id"]})
    return _out(doc, trips_as_vehicle=trips)


@router.patch("/{vehicle_id}", response_model=VehicleOut)
async def update_vehicle(vehicle_id: str, body: VehicleUpdateIn, user: Dict = Depends(_driver)):
    """Edit own car. Material edits reset verification to pending (safety:
    admin must re-check changed cars). Toggling is_active alone is exempt."""
    db = get_db()
    patch = {}
    for field in ("make", "model", "year", "color", "seats_total",
                  "fuel_type", "mileage_kmpl", "is_active"):
        val = getattr(body, field)
        if val is not None:
            patch[field] = val.strip() if isinstance(val, str) else val
    if body.plate_no is not None:
        patch["plate_no"] = body.plate_no
    # image_url is the one field where "leave it alone" and "clear it" both look
    # like None (the validator maps "" -> None), so we ask Pydantic which keys
    # the client actually sent. Explicit key = set it; null/"" = clear it;
    # key absent = untouched. Without this a blank box could never clear a photo.
    if "image_url" in body.model_fields_set:
        patch["image_url"] = body.image_url
    if not patch:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nothing to update")
    # Cosmetic-only edits (photo, active toggle) must NOT dump the car back into
    # the admin verification queue — a changed photo doesn't alter safety.
    if any(k not in ("is_active", "image_url") for k in patch):
        patch["verification_status"] = "pending"
        patch["verification_note"] = "auto: edited after review, needs re-check"
    patch["updated_at"] = _utcnow()
    try:
        doc = await db.vehicles.find_one_and_update(
            {"_id": _oid(vehicle_id), "owner_id": ObjectId(user["id"])},
            {"$set": patch},
            return_document=True,
        )
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "plate number already registered")
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    assert doc["plate_no"] == normalise_plate(doc["plate_no"])
    return _out(doc)


@router.delete("/{vehicle_id}")
async def delete_vehicle(vehicle_id: str, user: Dict = Depends(_driver)):
    """Soft delete (is_active=False) — trip history stays intact for Modules 6+."""
    db = get_db()
    doc = await db.vehicles.find_one_and_update(
        {"_id": _oid(vehicle_id), "owner_id": ObjectId(user["id"]), "is_active": True},
        {"$set": {"is_active": False, "updated_at": _utcnow()}},
        return_document=True,
    )
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found or already inactive")
    return {"deleted": True, "id": str(doc["_id"])}


@router.get("/admin/pending", response_model=List[VehicleOut])
async def admin_pending(user: Dict = Depends(_admin)):
    _ = user
    db = get_db()
    cur = db.vehicles.find({"verification_status": "pending", "is_active": True}).sort("created_at", 1)
    return [_out(d) async for d in cur]


@router.post("/admin/{vehicle_id}/verify", response_model=VehicleOut)
async def admin_verify(
    vehicle_id: str,
    decision: str = Query(default="verified", pattern="^(verified|rejected)$"),
    note: str = Query(default=""),
    user: Dict = Depends(_admin),
):
    _ = user
    db = get_db()
    doc = await db.vehicles.find_one_and_update(
        {"_id": _oid(vehicle_id)},
        {"$set": {"verification_status": decision,
                  "verification_note": note or None,
                  "updated_at": _utcnow()}},
        return_document=True,
    )
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    return _out(doc)
