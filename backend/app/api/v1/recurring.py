"""Recurring series (Module 15): daily / weekdays / weekly trip series.

Option A - materialise REAL trip documents: each instance is a full trip
(published, same route/seats/vehicle/policy as the base), tagged with
recurring_group_id. Everything downstream (search, booking windows, cost,
segments, tracking) works unchanged because instances ARE trips.

Lifecycle:
- POST /trips/{id}/recurring    create series + first materialisation
- POST /recurring/{gid}/extend  roll the horizon forward from today
- GET  /recurring/{gid}         group + instance summary
- DELETE /recurring/{gid}       stop: cancel future unbooked, keep booked
- POST /recurring/{gid}/book    month pass: one booking per instance
"""
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, HTTPException, status

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.services.booking_window import check_window
from app.services.recurring import describe, materialise_dates

router = APIRouter(tags=["recurring"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str = "not found") -> ObjectId:
    if not ObjectId.is_valid(str(v)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(str(v))


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _coerce_start(v, fallback: datetime):
    if v is None:
        return fallback.date()
    if isinstance(v, datetime):
        return _aware(v).date()
    s = str(v)
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "bad starts_on date")


async def _load_group(db, group_id: str) -> Dict:
    doc = await db.recurring_groups.find_one({"group_id": group_id})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "series not found")
    return doc


def _date_from_base(base_depart: datetime, day) -> datetime:
    return datetime(day.year, day.month, day.day,
                    base_depart.hour, base_depart.minute,
                    tzinfo=timezone.utc)


async def _materialise(db, base: Dict, group: Dict, dates: list) -> int:
    now = _utcnow()
    base_depart = _aware(base["depart_at"])
    existing = {base_depart.date()}
    async for d in db.trips.find(
            {"recurring_group_id": group["group_id"]}, {"depart_at": 1}):
        dep = d.get("depart_at")
        if dep is not None:
            existing.add(_aware(dep).date())
    created = 0
    for day in dates:
        if day in existing:
            continue
        clone = {k: v for k, v in base.items()
                 if k not in ("_id", "created_at", "updated_at", "status",
                              "seats_booked", "depart_at")}
        clone.update({
            "depart_at": _date_from_base(base_depart, day),
            "seats_booked": 0,
            "status": "published",
            "recurring_group_id": group["group_id"],
            "created_at": now,
            "updated_at": now,
        })
        await db.trips.insert_one(clone)
        created += 1
        existing.add(day)
    return created

# __PART2__


@router.post("/trips/{trip_id}/recurring", status_code=200)
async def create_series(
    trip_id: str,
    payload: Dict = Body(...),
    user: Dict = Depends(get_current_user),
):
    db = get_db()
    trip = await db.trips.find_one({"_id": _oid(trip_id, "trip not found")})
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if str(trip["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your trip")
    status_now = trip.get("status")
    if status_now not in ("draft", "published"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only draft/published trips can start a series")
    if trip.get("recurring_group_id"):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "this trip already belongs to a series")
    rule = payload.get("rule")
    weekly_days = payload.get("weekly_days")
    if rule not in ("daily", "weekdays", "weekly"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "rule must be daily|weekdays|weekly")
    if weekly_days is not None:
        try:
            weekly_days = [int(d) for d in weekly_days]
        except (TypeError, ValueError):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "bad weekly_days")
        if any(d < 0 or d > 6 for d in weekly_days):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "bad weekly_days")
    if status_now == "draft":
        await db.trips.update_one(
            {"_id": trip["_id"]},
            {"$set": {"status": "published", "updated_at": _utcnow()}})
    settings = get_settings()
    try:
        horizon = int(payload.get("horizon_days")
                      or settings.RECURRING_HORIZON_DAYS)
    except (TypeError, ValueError):
        horizon = settings.RECURRING_HORIZON_DAYS
    depart = _aware(trip["depart_at"])
    starts_on_d = _coerce_start(payload.get("starts_on"), depart)
    if starts_on_d > depart.date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "starts_on must be on or before base trip date")
    group_id = uuid.uuid4().hex[:16]
    group = {
        "group_id": group_id,
        "driver_id": trip["driver_id"],
        "base_trip_id": trip["_id"],
        "rule": rule,
        "weekly_days": weekly_days,
        "starts_on": starts_on_d.isoformat(),
        "stops_on": payload.get("stops_on"),
        "horizon_days": horizon,
        "active": True,
        "created_at": _utcnow(),
    }
    await db.recurring_groups.insert_one(group)
    dates = materialise_dates(rule, starts_on_d, payload.get("stops_on"),
                              weekly_days, horizon,
                              settings.RECURRING_MAX_DAYS)
    # The base trip is always part of its own series: if its date is not
    # covered by the rule (e.g. a Sunday base with a weekday rule), union
    # it in so response dates == actual instance dates.
    base_day = depart.date()
    if base_day not in dates:
        dates = sorted(dates + [base_day])
    created = await _materialise(db, trip, group, dates)
    await db.trips.update_one(
        {"_id": trip["_id"]},
        {"$set": {"recurring_group_id": group_id, "updated_at": _utcnow()}})
    return {
        "group_id": group_id,
        "rule": describe(rule, weekly_days),
        "dates": [d.isoformat() for d in dates],
        "instances_created": created + 1,
    }

# __PART3__


@router.post("/recurring/{group_id}/extend", status_code=200)
async def extend_series(
    group_id: str,
    payload: Optional[Dict] = Body(None),
    user: Dict = Depends(get_current_user),
):
    db = get_db()
    group = await _load_group(db, group_id)
    if str(group["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your series")
    if not group.get("active", True):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "series is stopped")
    base = await db.trips.find_one({"_id": group["base_trip_id"]})
    if base is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "base trip gone")
    settings = get_settings()
    payload = payload or {}
    try:
        horizon = int(payload.get("horizon_days") or group.get("horizon_days")
                      or settings.RECURRING_HORIZON_DAYS)
    except (TypeError, ValueError):
        horizon = settings.RECURRING_HORIZON_DAYS
    today = _utcnow().date()
    dates = materialise_dates(group["rule"], today, None,
                              group.get("weekly_days"),
                              horizon, settings.RECURRING_MAX_DAYS)
    created = await _materialise(db, base, group, dates)
    return {
        "group_id": group_id,
        "extended": [d.isoformat() for d in dates],
        "instances_created": created,
    }


@router.get("/recurring/{group_id}", status_code=200)
async def get_series(group_id: str, user: Dict = Depends(get_current_user)):
    db = get_db()
    group = await _load_group(db, group_id)
    if str(group["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "series not found")
    trips = []
    async for t in db.trips.find(
            {"recurring_group_id": group_id},
            {"depart_at": 1, "seats_offered": 1, "seats_booked": 1,
             "status": 1}):
        dep = _aware(t["depart_at"])
        trips.append({
            "_id": str(t["_id"]),
            "depart_at": dep.isoformat(),
            "seats_offered": t.get("seats_offered", 0),
            "seats_booked": t.get("seats_booked", 0),
            "status": t.get("status"),
        })
    now = _utcnow()
    trips.sort(key=lambda x: x["depart_at"])
    upcoming = [t for t in trips
                if datetime.fromisoformat(t["depart_at"]) >= now]
    with_bookings = sum(1 for t in trips if t["seats_booked"] > 0)
    cancelled = sum(1 for t in trips if t.get("status") == "cancelled")
    return {
        "group_id": group_id,
        "rule": describe(group["rule"], group.get("weekly_days")),
        "active": group.get("active", True),
        "starts_on": group.get("starts_on"),
        "stops_on": group.get("stops_on"),
        "instances": trips,
        "counts": {
            "total": len(trips),
            "upcoming": len(upcoming),
            "with_bookings": with_bookings,
            "cancelled": cancelled,
        },
    }


@router.delete("/recurring/{group_id}", status_code=200)
async def stop_series(group_id: str, user: Dict = Depends(get_current_user)):
    db = get_db()
    group = await _load_group(db, group_id)
    if str(group["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your series")
    if not group.get("active", True):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "series already stopped")
    now = _utcnow()
    result = await db.trips.update_many(
        {"recurring_group_id": group_id, "depart_at": {"$gte": now},
         "seats_booked": 0, "status": "published"},
        {"$set": {"status": "cancelled", "updated_at": now}})
    kept = await db.trips.count_documents(
        {"recurring_group_id": group_id, "depart_at": {"$gte": now},
         "seats_booked": {"$gt": 0}})
    await db.recurring_groups.update_one(
        {"group_id": group_id},
        {"$set": {"active": False, "stops_on": now.date().isoformat()}})
    return {"group_id": group_id, "cancelled": result.modified_count,
            "kept_with_bookings": kept}

# __PART4__


@router.post("/recurring/{group_id}/book", status_code=200)
async def book_series(
    group_id: str,
    payload: Dict = Body(...),
    user: Dict = Depends(get_current_user),
):
    db = get_db()
    group = await _load_group(db, group_id)
    if not group.get("active", True):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "series is stopped")
    seats = payload.get("seats", 1)
    try:
        seats = int(seats)
    except (TypeError, ValueError):
        seats = 1
    if seats < 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad seats")
    pickup_coords = payload.get("pickup_coordinates") or [0.0, 0.0]
    dropoff_coords = payload.get("dropoff_coordinates") or [0.0, 0.0]
    try:
        pickup_coords = [float(pickup_coords[0]), float(pickup_coords[1])]
        dropoff_coords = [float(dropoff_coords[0]), float(dropoff_coords[1])]
    except (TypeError, ValueError, IndexError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "bad pickup/dropoff coordinates")
    now = _utcnow()
    instances = []
    async for t in db.trips.find(
            {"recurring_group_id": group_id,
             "depart_at": {"$gte": now},
             "status": "published"}):
        instances.append(t)
    instances.sort(key=lambda t: _aware(t["depart_at"]))
    if not instances:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "no upcoming instances to book")
    results = []
    for inst in instances:
        dep = _aware(inst["depart_at"])
        row: Dict = {"date": dep.date().isoformat(),
                     "trip_id": str(inst["_id"])}
        win = check_window(dep, inst.get("advance_policy"))
        if not win["bookable"]:
            row.update({"ok": False, "reason": win["reason"]})
            results.append(row)
            continue
        existing = await db.bookings.find_one(
            {"trip_id": inst["_id"],
             "passenger_id": ObjectId(user["id"]),
             "status": {"$in": ["requested", "accepted", "confirmed"]}})
        if existing is not None:
            row.update({"ok": False, "reason": "already booked"})
            results.append(row)
            continue
        seat_res = await db.trips.update_one(
            {"_id": inst["_id"],
             "$expr": {"$lte": [{"$add": ["$seats_booked", seats]},
                                "$seats_offered"]}},
            {"$inc": {"seats_booked": seats},
             "$set": {"updated_at": _utcnow()}})
        if seat_res.modified_count == 0:
            row.update({"ok": False, "reason": "sold out"})
            results.append(row)
            continue
        bnow = _utcnow()
        booking_doc = {
            "trip_id": inst["_id"],
            "driver_id": inst["driver_id"],
            "passenger_id": ObjectId(user["id"]),
            "seats": seats,
            "status": "requested",
            "pickup": {"name": "Series pickup",
                       "point": {"type": "Point",
                                 "coordinates": list(pickup_coords)}},
            "dropoff": {"name": "Series drop-off",
                        "point": {"type": "Point",
                                  "coordinates": list(dropoff_coords)}},
            "pickup_distance_m": None,
            "detour_km": None,
            "overlap_pct": None,
            "cost_share": None,
            "recurring_group_id": group_id,
            "created_at": bnow,
            "updated_at": bnow,
        }
        bres = await db.bookings.insert_one(booking_doc)
        row.update({"ok": True, "booking_id": str(bres.inserted_id)})
        results.append(row)
    ok_n = sum(1 for r in results if r.get("ok"))
    return {
        "group_id": group_id,
        "requested": ok_n,
        "dates": results,
        "note": "Each instance follows the normal accept/confirm flow.",
    }
