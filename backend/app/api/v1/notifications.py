"""Notifications (Module 23): the in-app event feed + the `emit()` hook.

- GET  /notifications            my feed (newest first, unread first)
- GET  /notifications/summary    bell counts only {unread, critical, by_type}
- POST /notifications/{id}/read  mark one read (own notifications only)
- POST /notifications/read-all   mark everything read

`emit()` is the write path every other module calls. Three rules it enforces:

1. NEVER RAISES. A notification failure must not roll back the booking, the
   trip or the safety alert that triggered it — errors are returned in the
   result dict instead, so a call site can log them without a try/except.
2. NEVER NOTIFIES STRANGERS. Recipients are resolved from the catalog's
   `audience` rule against the real booking/trip, so a passenger cannot be
   notified about someone else's ride.
3. DEDUPES DERIVED FACTS. A `KEY` event upserts on (user, dedupe_key) — the
   same acceptance cannot notify twice. `NEVER` events (SOS) always insert.

Lazy-imported by bookings/trips/safety/recurring at their call sites, matching
the existing pattern for segments/safety (avoids a router import cycle).
"""
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.notification import NotificationFeed, NotificationOut
from app.services.notify import (
    EVENT_CATALOG,
    dedupe_key,
    render,
    sorted_feed,
    unread_summary,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])

FEED_LIMIT = 50
MAX_FEED = 200


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str = "notification not found") -> ObjectId:
    if not ObjectId.is_valid(str(v)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(str(v))


async def _user_name(db, user_id) -> str:
    if user_id is None:
        return ""
    doc = await db.users.find_one({"_id": ObjectId(str(user_id))}, {"full_name": 1})
    return (doc or {}).get("full_name") or ""


def _out(doc: Dict) -> Dict:
    return {
        "id": str(doc["_id"]),
        "type": doc.get("type"),
        "title": doc.get("title"),
        "body": doc.get("body"),
        "priority": doc.get("priority", "normal"),
        "action": doc.get("action"),
        "trip_id": str(doc["trip_id"]) if doc.get("trip_id") else None,
        "booking_id": str(doc["booking_id"]) if doc.get("booking_id") else None,
        "read_at": doc.get("read_at"),
        "created_at": doc.get("created_at"),
    }



async def _recipients(db, event: str, ctx: Dict) -> List[ObjectId]:
    """Resolve the catalog's audience rule to concrete user ids.

    Everything is derived from the real booking/trip documents, so a caller
    cannot notify a user who was not actually part of the event.
    """
    spec = EVENT_CATALOG.get(event) or {}
    audience = spec.get("audience")
    booking = ctx.get("_booking")
    trip = ctx.get("_trip")
    if booking is None and ctx.get("booking_id"):
        booking = await db.bookings.find_one({"_id": _oid(str(ctx["booking_id"]))})
    if trip is None and ctx.get("trip_id"):
        trip = await db.trips.find_one({"_id": _oid(str(ctx["trip_id"]))})
    if booking is None and trip is None:
        return []

    driver_id = booking.get("driver_id") if booking is not None else None
    passenger_id = booking.get("passenger_id") if booking is not None else None
    if trip is not None:
        driver_id = trip.get("driver_id") or driver_id
    actor = str(ctx.get("actor_id") or "")

    def _add(out: List[ObjectId], value) -> None:
        if value is not None and ObjectId(str(value)) not in out:
            out.append(ObjectId(str(value)))

    if audience == "driver":
        out: List[ObjectId] = []
        _add(out, driver_id)
        return out
    if audience == "passenger":
        out = []
        _add(out, passenger_id)
        return out
    if audience == "other_party":
        out = []
        # whoever did NOT trigger it, so neither side notifies itself
        _add(out, driver_id if actor == str(passenger_id) else passenger_id)
        return out
    # admins (and driver+admins): the alert console must always hear about it
    out = []
    if audience == "driver+admins":
        _add(out, driver_id)
    async for admin in db.users.find({"roles": "admin", "status": "active"},
                                     {"_id": 1}):
        _add(out, admin["_id"])
    return out


async def emit(db, event: str, actor_id=None, **ctx) -> Dict:
    """Create notifications for `event`. NEVER raises.

    Returns {emitted, skipped, error} so a caller can log a problem without a
    try/except, and so tests can assert the delivery count.
    """
    try:
        payload = render(event, ctx)
        if payload is None:
            return {"emitted": 0, "skipped": 0,
                    "error": "unknown event " + str(event)}
        recipients = await _recipients(db, event, ctx)
        if not recipients:
            return {"emitted": 0, "skipped": 1, "error": None}
        key = dedupe_key(event, ctx)
        now = _utcnow()
        emitted = 0
        for user_id in recipients:
            doc = {
                "user_id": user_id, "type": payload["type"],
                "title": payload["title"], "body": payload["body"],
                "priority": payload["priority"], "action": payload.get("action"),
                "trip_id": ObjectId(str(ctx["trip_id"])) if ctx.get("trip_id") else None,
                "booking_id": (ObjectId(str(ctx["booking_id"]))
                               if ctx.get("booking_id") else None),
                "read_at": None,
            }
            if key:
                # KEY events upsert: one notification per (user, thing).
                # `created_at` is set ONLY on insert so a re-emission refreshes
                # the text without moving the item in the feed (sort_key sorts
                # by created_at) — and $set/$setOnInsert must not collide.
                res = await db.notifications.update_one(
                    {"user_id": user_id, "dedupe_key": key},
                    {"$set": dict(doc, dedupe_key=key),
                     "$setOnInsert": {"created_at": now}},
                    upsert=True)
                if res.upserted_id:
                    emitted += 1
            else:
                # NEVER events: the key field is OMITTED entirely, so the
                # sparse unique index never sees two nulls.
                await db.notifications.insert_one(dict(doc, created_at=now))
                emitted += 1
        return {"emitted": emitted, "skipped": 0, "error": None}
    except Exception as exc:  # never break the caller's happy path
        # Swallowed for the caller, but NOT silent — a dropped notification is
        # a bug, and this is the only place it would otherwise go unnoticed.
        log.warning("notification emit failed for %s: %s: %s", event,
                    type(exc).__name__, exc)
        return {"emitted": 0, "skipped": 0,
                "error": "{}: {}".format(type(exc).__name__, exc)}


async def notify_booking(db, event: str, booking: Dict,
                         trip: Optional[Dict] = None, actor_id=None,
                         **extra) -> Dict:
    """Convenience wrapper: build the human context for a booking/trip event."""
    if trip is None and booking is not None:
        trip = await db.trips.find_one({"_id": booking["trip_id"]})
    route = "your trip"
    if trip is not None:
        route = "{} → {}".format((trip.get("source") or {}).get("name") or "?",
                                 (trip.get("destination") or {}).get("name") or "?")
    return await emit(
        db, event, actor_id=actor_id,
        booking_id=str(booking["_id"]) if booking is not None else None,
        trip_id=str(booking["trip_id"]) if booking is not None else None,
        driver=await _user_name(db, booking.get("driver_id") if booking else None),
        passenger=await _user_name(db, booking.get("passenger_id") if booking else None),
        route=route, seats=int((booking or {}).get("seats", 1) or 1),
        _booking=booking, _trip=trip, **extra)

@router.get("", response_model=NotificationFeed)
async def my_notifications(user: Dict = Depends(get_current_user),
                           limit: int = Query(default=FEED_LIMIT, ge=1, le=MAX_FEED),
                           unread_only: bool = False):
    """My feed, unread first then by priority then newest."""
    db = get_db()
    query: Dict = {"user_id": ObjectId(user["id"])}
    if unread_only:
        query["read_at"] = None
    docs = await db.notifications.find(query).sort("created_at", -1).limit(
        MAX_FEED).to_list(MAX_FEED)
    stats = unread_summary(docs)
    rows = sorted_feed(docs, limit)
    return NotificationFeed(count=len(rows), unread=stats["unread"],
                            critical=stats["critical"], by_type=stats["by_type"],
                            items=[_out(d) for d in rows])


@router.get("/summary")
async def notification_summary(user: Dict = Depends(get_current_user)):
    """Bell counts only — the cheap poll the NavBar makes."""
    db = get_db()
    docs = await db.notifications.find(
        {"user_id": ObjectId(user["id"]), "read_at": None}).to_list(200)
    return unread_summary(docs)


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: str, user: Dict = Depends(get_current_user)):
    """Mark one of MY notifications read. Someone else's is simply 404."""
    db = get_db()
    doc = await db.notifications.find_one_and_update(
        {"_id": _oid(notification_id), "user_id": ObjectId(user["id"])},
        {"$set": {"read_at": _utcnow()}}, return_document=True)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")
    return _out(doc)


@router.post("/read-all")
async def mark_all_read(user: Dict = Depends(get_current_user)):
    db = get_db()
    res = await db.notifications.update_many(
        {"user_id": ObjectId(user["id"]), "read_at": None},
        {"$set": {"read_at": _utcnow()}})
    return {"marked": int(res.modified_count)}
