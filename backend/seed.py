"""One-command demo seed (Module 25).

Builds a believable dataset so a viva/demo has something to show without
hand-typing six accounts and three trips:

    python seed.py                 # wipe the seed set, then rebuild it
    python seed.py --keep          # rebuild only what is missing

Creates, for phone +919000000001 .. +919000000006:
  - 1 admin (promoted directly, the only route to the role — Module 3)
  - 2 verified drivers with verified vehicles
  - 2 verified passengers with preferences
  - 1 published trip you can search and book immediately
  - 1 completed trip with a confirmed rider, a settled cost_share, segments,
    a rating each way, and the notifications that ride generated

Every document is written directly (not through the API) so seeding is fast and
does not need the server running — but the SHAPES are exactly what the API
validators expect, so `python init_db.py` must have run first.

Safety: only touches phone numbers >= +919000000001 and trips named
"SeedTest %"; it never deletes real user data. Every run is idempotent.
"""
import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List

from bson import ObjectId

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from app.core.database import get_client, get_settings  # noqa: E402
from app.core.indexes import ensure_indexes  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services.cost import distribute, resolve_fuel_price, total_fuel_cost  # noqa: E402

SEED_PHONES = ["+91900000000" + str(i) for i in range(1, 7)]
ADMIN_PHONE, DRV1, DRV2, PAX1, PAX2, PAX3 = SEED_PHONES
PASSWORD = "pass1234"
# Bengaluru-ish corridor used throughout the project's tests and docs
ROUTE = [[77.5946, 13.0358], [77.6100, 13.0200], [77.6250, 12.9900],
         [77.6450, 12.9400], [77.6600, 12.8900], [77.6700, 12.8452]]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _user(db, phone: str, name: str, roles: List[str],
                verified: bool = True) -> ObjectId:
    now = _utcnow()
    # Hashed with the real helper so these accounts can actually log in through
    # /login — a seed you cannot sign into is not a demo seed.
    doc = {
        "phone": phone, "full_name": name, "roles": roles,
        "password_hash": hash_password(PASSWORD),
        "phone_verified": verified, "status": "active",
        "rating_avg": None, "rating_count": 0,
        "created_at": now, "updated_at": now,
    }
    await db.users.update_one({"phone": phone}, {"$set": doc}, upsert=True)
    return ObjectId((await db.users.find_one({"phone": phone}))["_id"])


async def _vehicle(db, owner: ObjectId, plate: str, fuel: str,
                   mileage: float) -> ObjectId:
    now = _utcnow()
    doc = {"owner_id": owner, "make": "Demo", "model": fuel.title() + " Hatch",
           "plate_no": plate, "seats_total": 3, "fuel_type": fuel,
           "mileage_kmpl": mileage, "verification_status": "verified",
           # Year/colour never affect the maths, but the garage card and the
           # Module 12 cost panel both render them — without these the demo
           # shows a bare "Demo Petrol Hatch" and a blank year.
           "year": 2021, "color": "Blue",
           "is_active": True, "created_at": now, "updated_at": now}
    await db.vehicles.update_one({"plate_no": plate}, {"$set": doc}, upsert=True)
    return ObjectId((await db.vehicles.find_one({"plate_no": plate}))["_id"])
# ---MARK---

async def _trip(db, driver: ObjectId, vehicle: ObjectId, name: str,
                depart: datetime, status: str, seats: int,
                seats_booked: int) -> ObjectId:
    now = _utcnow()
    doc = {
        "driver_id": driver, "vehicle_id": vehicle,
        "source": {"name": "SeedTest " + name + " Gate",
                   "point": {"type": "Point", "coordinates": ROUTE[0]}},
        "destination": {"name": "SeedTest " + name + " Terminal",
                        "point": {"type": "Point", "coordinates": ROUTE[-1]}},
        "route_geometry": {"type": "LineString", "coordinates": ROUTE},
        "distance_km": 30.0, "duration_min": 52.0, "depart_at": depart,
        "seats_offered": seats, "seats_booked": seats_booked, "status": status,
        "created_at": now, "updated_at": now,
    }
    if status == "completed":
        doc["started_at"] = depart
        doc["completed_at"] = depart + timedelta(minutes=48)
    await db.trips.update_one({"source.name": "SeedTest " + name + " Gate"},
                              {"$set": doc}, upsert=True)
    return ObjectId((await db.trips.find_one(
        {"source.name": "SeedTest " + name + " Gate"}))["_id"])


async def _seed_history(db, trip: ObjectId, driver: ObjectId,
                        riders: List[ObjectId], fuel: str, mileage: float) -> None:
    """A completed ride with segments, settled money, ratings and notifications.

    This is what makes /analytics and the Module 22/23 surfaces non-empty on a
    fresh demo, so the reports have something real to show.
    """
    now = _utcnow()
    trip_doc = await db.trips.find_one({"_id": trip})
    price = resolve_fuel_price(fuel, None)
    policy = {"mode": "split_equal", "fuel_price": price, "mileage_kmpl": mileage}
    await db.trips.update_one({"_id": trip}, {"$set": {"price_policy": policy}})
    total = total_fuel_cost(30.0, mileage, price)["total_cost"]
    shares = distribute("split_equal", total, 3,
                        [{"id": str(b), "seats": 1} for b in riders])
    booking_ids = []
    for b in riders:
        doc = {
            "trip_id": trip, "passenger_id": b, "driver_id": driver, "seats": 1,
            "status": "completed", "match_score": 88.0, "ai_score": 91.0,
            "overlap_pct": 82.0, "detour_km": 1.2, "pickup_distance_m": 180.0,
            "pickup": {"name": "SeedTest pickup",
                       "point": {"type": "Point", "coordinates": ROUTE[1]}},
            "dropoff": {"name": "SeedTest drop",
                        "point": {"type": "Point", "coordinates": ROUTE[4]}},
            "cost_share": shares.get(str(b)), "closed_at": now,
            "created_at": now, "updated_at": now,
        }
        await db.bookings.update_one({"trip_id": trip, "passenger_id": b},
                                     {"$set": doc}, upsert=True)
        booking_ids.append(ObjectId((await db.bookings.find_one(
            {"trip_id": trip, "passenger_id": b}))["_id"]))
    # one segment per rider leg (Module 13 shape) so /analytics has real km
    for i, b in enumerate(booking_ids):
        await db.segments.update_one(
            {"trip_id": trip, "seq": i},
            {"$set": {"from_label": "Leg " + str(i),
                      "to_label": "Leg " + str(i + 1),
                      "from_point": {"type": "Point", "coordinates": ROUTE[i]},
                      "to_point": {"type": "Point", "coordinates": ROUTE[i + 1]},
                      "distance_km": 10.0, "occupant_booking_ids": [b],
                      "created_at": now}}, upsert=True)
    # ratings + notifications, so /me, the bell and the admin board are alive
    for i, b in enumerate(booking_ids):
        await db.ratings.update_one(
            {"booking_id": b, "rater_id": riders[i]},
            {"$set": {"trip_id": trip, "target_id": driver, "stars": 5,
                      "comment": "Smooth ride, on time.",
                      "updated_at": now, "created_at": now}}, upsert=True)
        await db.ratings.update_one(
            {"booking_id": b, "rater_id": driver},
            {"$set": {"trip_id": trip, "target_id": riders[i], "stars": 5,
                      "comment": "Great passenger.",
                      "updated_at": now, "created_at": now}}, upsert=True)
        await db.notifications.update_one(
            {"user_id": riders[i],
             "dedupe_key": "trip_completed:{}".format(b)},
            {"$set": {"type": "trip_completed",
                      "title": "Trip completed — rate your ride",
                      "body": "Your ride on SeedTest West Gate → Terminal is "
                              "finished. Rate your driver in one tap.",
                      "priority": "normal", "action": "rate", "trip_id": trip,
                      "booking_id": b, "read_at": None,
                      "created_at": now}}, upsert=True)
    await db.users.update_one({"_id": driver},
                              {"$set": {"rating_avg": 5.0, "rating_count": 2}})
    for b in riders:
        await db.users.update_one({"_id": b},
                                  {"$set": {"rating_avg": 5.0, "rating_count": 1}})


async def _fallthrough(db, trip: ObjectId, driver: ObjectId,
                      rider: ObjectId, match: float, ai: float) -> None:
    """A booking that was requested and then cancelled.

    Without at least one negative outcome the Module 24 evaluation correctly
    reports AUC = None ("only one class"), which makes the demo table look
    broken. One fall-through booking fixes that honestly.
    """
    now = _utcnow()
    await db.bookings.update_one(
        {"trip_id": trip, "passenger_id": rider},
        {"$set": {"trip_id": trip, "passenger_id": rider, "driver_id": driver,
                  "seats": 1, "status": "cancelled", "match_score": match,
                  "ai_score": ai, "overlap_pct": 18.0, "detour_km": 3.4,
                  "pickup": {"name": "SeedTest far pickup",
                             "point": {"type": "Point", "coordinates": ROUTE[0]}},
                  "dropoff": {"name": "SeedTest drop",
                              "point": {"type": "Point", "coordinates": ROUTE[-1]}},
                  "cost_share": None, "created_at": now, "updated_at": now}},
        upsert=True)


async def _wipe(db) -> None:
    """Remove ONLY the seed set. Never touches real accounts."""
    trips = [t["_id"] async for t in db.trips.find(
        {"source.name": {"$regex": "^SeedTest "}}, {"_id": 1})]
    if trips:
        for coll in ("bookings", "segments", "ratings", "safety_alerts"):
            await db[coll].delete_many({"trip_id": {"$in": trips}})
    await db.trips.delete_many({"_id": {"$in": trips}})
    await db.notifications.delete_many({"user_id": {
        "$in": [u["_id"] async for u in db.users.find(
            {"phone": {"$in": SEED_PHONES}}, {"_id": 1})]}})
    await db.ratings.delete_many({"rater_id": {
        "$in": [u["_id"] async for u in db.users.find(
            {"phone": {"$in": SEED_PHONES}}, {"_id": 1})]}})
    await db.vehicles.delete_many({"plate_no": {"$regex": "^SEED"}})
    await db.users.delete_many({"phone": {"$in": SEED_PHONES}})


async def main(keep: bool = False) -> None:
    settings = get_settings()
    db = get_client()[settings.MONGO_DB]
    if not keep:
        await _wipe(db)
    # ensure indexes so the seed's upserts run against the real validators
    await ensure_indexes(db)

    admin = await _user(db, ADMIN_PHONE, "Seed Admin", ["admin"])
    drv1 = await _user(db, DRV1, "Seed Driver One", ["driver", "passenger"])
    drv2 = await _user(db, DRV2, "Seed Driver Two", ["driver", "passenger"])
    pax1 = await _user(db, PAX1, "Seed Rider One", ["passenger"])
    pax2 = await _user(db, PAX2, "Seed Rider Two", ["passenger"])
    pax3 = await _user(db, PAX3, "Seed Rider Three", ["passenger"])

    v1 = await _vehicle(db, drv1, "SEED001", "petrol", 15.0)
    v2 = await _vehicle(db, drv2, "SEED002", "diesel", 18.0)

    # a live trip to search and book right now
    soon = (_utcnow() + timedelta(hours=6)).replace(
        minute=0, second=0, microsecond=0)
    await _trip(db, drv1, v1, "East", soon, "published", 3, 0)
    await _trip(db, drv2, v2, "North", soon + timedelta(hours=1), "published", 2, 0)

    # History. The completed trip gives /analytics, ratings and the admin board
    # something real; the extra past days give the demand forecast a train/test
    # split big enough to backtest (it needs >4 departures to split at all).
    past = (_utcnow() - timedelta(days=6)).replace(
        hour=9, minute=0, second=0, microsecond=0)
    done = await _trip(db, drv1, v1, "West", past, "completed", 3, 2)
    await _seed_history(db, done, drv1, [pax1, pax2], "petrol", 15.0)
    # one booking that fell through, so the Module 24 evaluation has BOTH
    # classes — with only positives the AUC is correctly reported as None
    await _fallthrough(db, done, drv1, pax3, 12.0, 6.0)

    riders_cycle = [pax1, pax2, pax3]
    for i in range(1, 6):
        when = (_utcnow() - timedelta(days=6 - i)).replace(
            hour=8 + (i % 3), minute=0, second=0, microsecond=0)
        driver, veh, fuel, mile = ((drv1, v1, "petrol", 15.0) if i % 2
                                   else (drv2, v2, "diesel", 18.0))
        t = await _trip(db, driver, veh, "Day" + str(i), when, "completed", 3, 1)
        await _seed_history(db, t, driver,
                            [riders_cycle[i % len(riders_cycle)]], fuel, mile)
    _ = admin

    print("Seed complete -> database '" + settings.MONGO_DB + "'")
    print("Sign in at /login with any of these (all share the password below),")
    print("then open /verify — the dev OTP is displayed on screen.")
    print("  password: " + PASSWORD)
    for phone, role in ((ADMIN_PHONE, "admin"), (DRV1, "driver"),
                        (DRV2, "driver"), (PAX1, "passenger"),
                        (PAX2, "passenger"), (PAX3, "passenger")):
        print("    " + phone + "  " + role)
    print("Try: log in as a passenger, /search for the SeedTest corridor, book")
    print("the ride, then /analytics to see the seeded impact + forecast.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed demo data (Module 25)")
    parser.add_argument("--keep", action="store_true",
                        help="do not wipe the seed set first (upsert only)")
    args = parser.parse_args()
    asyncio.run(main(keep=args.keep))
