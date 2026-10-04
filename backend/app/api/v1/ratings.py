"""Ratings & reviews (Module 22): the trust layer that needs a finished ride.

- POST /ratings              {booking_id, stars, comment?} — rate the OTHER
                             party on a completed booking. One vote per
                             (booking, rater): re-posting updates in place.
- GET  /ratings/pending      every completed ride I was part of, with my own
                             score (null = not rated yet) — drives "rate your
                             ride" prompts for drivers AND passengers.
- GET  /ratings/booking/{id} the (0..2) reviews on one booking; parties only.
- GET  /ratings/user/{id}    public review card: aggregate + histogram + feed.

DESIGN NOTES
- The `ratings` collection is the source of truth; `users.rating_avg/count` is
  a CACHE of services.ratings.aggregate() over that collection, recomputed on
  every write. No `$inc` ledger, so a crash mid-write cannot leave a drifted
  score — the discipline Module 19 used for frozen money.
- Eligibility (party -> completed -> other party) is the pure
  `rating_eligibility()`; this module only performs writes.
- A rating is one-directional per booking, so a rider cannot inflate a driver's
  score, and nobody is reviewed for a ride they were not part of.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.rating import RatingCard, RatingIn, RatingOut
from app.services.ratings import (
    aggregate,
    clean_comment,
    distribution,
    rateable_rows,
    rating_eligibility,
)

router = APIRouter(prefix="/ratings", tags=["ratings"])

# Cap the "rate your ride" scan and the public feed: a long history is served
# newest-first rather than in full.
PENDING_SCAN = 50
FEED_LIMIT = 20


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(str(v)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(str(v))


async def _names(db, ids: List[ObjectId]) -> Dict[str, str]:
    """One $in query for a batch of display names (avoids N+1 in the feed)."""
    uniq = [ObjectId(str(x)) for x in {str(i) for i in ids} if x is not None]
    if not uniq:
        return {}
    out: Dict[str, str] = {}
    async for doc in db.users.find({"_id": {"$in": uniq}}, {"full_name": 1}):
        out[str(doc["_id"])] = doc.get("full_name") or ""
    return out


async def _recompute(db, target_id: str) -> Dict:
    """Refresh the target's cached aggregate from the ratings collection."""
    agg = {"avg": None, "count": 0}
    cur = db.ratings.aggregate([
        {"$match": {"target_id": ObjectId(str(target_id))}},
        {"$group": {"_id": None, "avg": {"$avg": "$stars"}, "n": {"$sum": 1}}},
    ])
    async for row in cur:
        agg = {"avg": round(float(row["avg"]), 2), "count": int(row["n"])}
        break
    await db.users.update_one(
        {"_id": ObjectId(str(target_id))},
        {"$set": {"rating_avg": agg["avg"], "rating_count": agg["count"],
                  "updated_at": _utcnow()}})
    return agg


async def _out(db, doc: Dict, target_agg: Optional[Dict] = None) -> Dict:
    names = await _names(db, [doc.get("rater_id"), doc.get("target_id")])
    row = {
        "id": str(doc["_id"]),
        "booking_id": str(doc["booking_id"]),
        "trip_id": str(doc["trip_id"]),
        "rater_id": str(doc["rater_id"]),
        "target_id": str(doc["target_id"]),
        "stars": int(doc["stars"]),
        "comment": doc.get("comment"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "rater_name": names.get(str(doc.get("rater_id"))) or None,
        "target_name": names.get(str(doc.get("target_id"))) or None,
    }
    if target_agg is not None:
        row["target_rating_avg"] = target_agg["avg"]
        row["target_rating_count"] = target_agg["count"]
    return row
@router.post("", response_model=RatingOut)
async def rate_ride(body: RatingIn, user: Dict = Depends(get_current_user)):
    """Rate the other party on a completed ride. Idempotent per (booking, rater)."""
    db = get_db()
    booking = await db.bookings.find_one(
        {"_id": _oid(body.booking_id, "booking not found")})
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "booking not found")
    verdict = rating_eligibility(booking, user["id"])
    if not verdict["allowed"]:
        code = (status.HTTP_403_FORBIDDEN if verdict["code"] == "forbidden"
                else status.HTTP_422_UNPROCESSABLE_ENTITY)
        raise HTTPException(code, verdict["reason"])

    rater = ObjectId(user["id"])
    target = ObjectId(verdict["target_id"])
    now = _utcnow()
    # Upsert on the unique pair: a second POST edits the score, it never stacks
    # a second vote. created_at survives via $setOnInsert.
    await db.ratings.update_one(
        {"booking_id": booking["_id"], "rater_id": rater},
        {"$set": {"trip_id": booking["trip_id"], "target_id": target,
                  "stars": int(body.stars),
                  "comment": clean_comment(body.comment),
                  "updated_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True)
    agg = await _recompute(db, verdict["target_id"])
    doc = await db.ratings.find_one(
        {"booking_id": booking["_id"], "rater_id": rater})
    return await _out(db, doc, agg)


@router.get("/pending")
async def pending_ratings(user: Dict = Depends(get_current_user)):
    """Completed rides I was part of, flagged with the score I already gave."""
    db = get_db()
    uid = ObjectId(user["id"])
    bookings = await db.bookings.find(
        {"$or": [{"passenger_id": uid}, {"driver_id": uid}],
         "status": "completed"},
        sort=[("closed_at", -1), ("created_at", -1)],
        limit=PENDING_SCAN).to_list(PENDING_SCAN)
    mine = {str(r["booking_id"]): int(r["stars"]) async for r in
            db.ratings.find({"rater_id": uid}, {"booking_id": 1, "stars": 1})}
    rows = rateable_rows(bookings, user["id"], mine)
    if not rows:
        return {"count": 0, "unrated": 0, "items": []}

    trip_names: Dict[str, Dict] = {}
    async for t in db.trips.find(
            {"_id": {"$in": [ObjectId(r["trip_id"]) for r in rows]}},
            {"source.name": 1, "destination.name": 1, "depart_at": 1}):
        trip_names[str(t["_id"])] = {
            "source_name": (t.get("source") or {}).get("name"),
            "destination_name": (t.get("destination") or {}).get("name"),
            "depart_at": t.get("depart_at")}
    names = await _names(db, [ObjectId(r["target_id"]) for r in rows])
    for r in rows:
        r["target_name"] = names.get(r["target_id"]) or None
        r["trip"] = trip_names.get(r["trip_id"])
    return {"count": len(rows),
            "unrated": len([r for r in rows if r["my_stars"] is None]),
            "items": rows}


@router.get("/booking/{booking_id}")
async def booking_ratings(booking_id: str, user: Dict = Depends(get_current_user)):
    """The reviews left on one booking — visible only to its two parties."""
    db = get_db()
    booking = await db.bookings.find_one({"_id": _oid(booking_id, "booking not found")})
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "booking not found")
    if str(user["id"]) not in (str(booking["passenger_id"]),
                               str(booking["driver_id"])) \
            and "admin" not in (user.get("roles") or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "reviews are visible to the two parties")
    docs = await db.ratings.find({"booking_id": booking["_id"]}).to_list(10)
    docs.sort(key=lambda d: (d.get("created_at") or _utcnow()))
    items = [await _out(db, d) for d in docs]
    return {"booking_id": str(booking["_id"]), "count": len(items),
            "items": items}


@router.get("/user/{user_id}", response_model=RatingCard)
async def user_ratings(user_id: str, user: Dict = Depends(get_current_user),
                       limit: int = Query(default=FEED_LIMIT, ge=1, le=100)):
    """Public review card: aggregate, histogram, and recent reviews received."""
    _ = user  # any logged-in user may read a card (trip listings show it)
    db = get_db()
    target = _oid(user_id, "user not found")
    profile = await db.users.find_one({"_id": target, "status": "active"})
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    docs = await db.ratings.find({"target_id": target}).sort(
        "created_at", -1).limit(100).to_list(100)
    stats = aggregate(docs)
    names = await _names(db, [d.get("rater_id") for d in docs])
    items = []
    for d in docs[:limit]:
        row = await _out(db, d)
        row["rater_name"] = names.get(str(d.get("rater_id"))) or None
        items.append(row)
    return RatingCard(
        user_id=str(profile["_id"]),
        full_name=profile.get("full_name") or None,
        roles=list(profile.get("roles") or []),
        rating_avg=stats["avg"],
        rating_count=stats["count"],
        distribution=distribution(docs),
        items=items,
    )
