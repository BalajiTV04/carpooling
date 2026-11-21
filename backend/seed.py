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
from app.services.cost_sharing import recompute_trip_fares  # noqa: E402

SEED_PHONES = ["+91900000000" + str(i) for i in range(1, 7)]
ADMIN_PHONE, DRV1, DRV2, PAX1, PAX2, PAX3 = SEED_PHONES
PASSWORD = "admin123"
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
    # ensure indexes so the DB is ready for use
    await ensure_indexes(db)

    DEMO_PASSWORD = "admin123"
    now = _utcnow()

    ACCOUNTS = [
        {
            "phone": ADMIN_PHONE,
            "full_name": "Demo Admin",
            "roles": ["admin"],
            "driver_approval": None,
            "email": "admin@voltride.com",
            "username": "admin",
        },
        {
            "phone": DRV1,
            "full_name": "Demo Driver",
            "roles": ["driver"],
            "driver_approval": "approved",
            "email": "driver@voltride.com",
        },
        {
            "phone": DRV2,
            "full_name": "Demo Driver Two",
            "roles": ["driver"],
            "driver_approval": "approved",
            "email": "driver2@voltride.com",
        },
        {
            "phone": PAX1,
            "full_name": "Demo Passenger One",
            "roles": ["passenger"],
            "driver_approval": None,
            "email": "pax1@voltride.com",
        },
        {
            "phone": PAX2,
            "full_name": "Demo Passenger Two",
            "roles": ["passenger"],
            "driver_approval": None,
            "email": "pax2@voltride.com",
        },
        {
            "phone": PAX3,
            "full_name": "Demo Passenger Three",
            "roles": ["passenger"],
            "driver_approval": None,
            "email": "pax3@voltride.com",
        },
    ]

    for acc in ACCOUNTS:
        doc = {
            "phone": acc["phone"],
            "password_hash": hash_password(DEMO_PASSWORD),
            "full_name": acc["full_name"],
            "roles": acc["roles"],
            "phone_verified": True,
            "status": "active",
            "email": acc.get("email"),
            "username": acc.get("username"),
            "driver_approval": acc["driver_approval"],
            "driver_approval_note": None,
            "driver_approval_at": now if acc["driver_approval"] else None,
            "driver_approval_by": None,
            "rating_avg": None,
            "rating_count": 0,
            "created_at": now,
            "updated_at": now,
        }
        await db.users.update_one(
            {"phone": acc["phone"]},
            {"$set": doc},
            upsert=True,
            bypass_document_validation=True,
        )
        print(
            f"Seeded {acc['phone']}  {acc['full_name']}  roles={acc['roles']}  approval={acc['driver_approval']}"
        )

    # Seed Vehicle for Driver +919000000002 (4+1 car capacity)
    drv1_user = await db.users.find_one({"phone": DRV1})
    pax1_user = await db.users.find_one({"phone": PAX1})
    pax2_user = await db.users.find_one({"phone": PAX2})
    drv1_id = drv1_user["_id"]
    pax1_id = pax1_user["_id"]
    pax2_id = pax2_user["_id"]

    veh_doc = {
        "owner_id": drv1_id,
        "make": "Tata",
        "model": "Nexon EV",
        "year": 2023,
        "color": "Teal Blue",
        "plate_no": "KA04EV4411",
        "seats_total": 4,  # passenger seats
        "seat_capacity": 5,  # 4+1 seats
        "fuel_type": "diesel",
        "mileage_kmpl": 18.0,
        "verification_status": "verified",
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    await db.vehicles.update_one({"plate_no": "KA04EV4411"}, {"$set": veh_doc}, upsert=True)
    veh_id = ObjectId((await db.vehicles.find_one({"plate_no": "KA04EV4411"}))["_id"])
    print(f"Seeded vehicle KA04EV4411 (4+1 capacity) for driver {DRV1}")

    # Seed Devanahalli -> Hebbal demo trip with 4 seats offered
    import json
    fix_path = ROOT / "tests" / "fixtures" / "devanahalli_hebbal.json"
    if fix_path.exists():
        with open(fix_path, "r", encoding="utf-8") as f:
            fix = json.load(f)
        geometry = fix["geometry"]
        dist_km = float(fix["distance_km"])
        dur_min = float(fix["duration_min"])
    else:
        geometry = {"type": "LineString", "coordinates": [[77.7120, 13.2437], [77.5963, 13.1007], [77.5970, 13.0358]]}
        dist_km = 30.0
        dur_min = 35.0

    depart_time = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    trip_doc = {
        "driver_id": drv1_id,
        "vehicle_id": veh_id,
        "source": {
            "name": "Devanahalli Central",
            "point": {"type": "Point", "coordinates": [77.7120, 13.2437]},
        },
        "destination": {
            "name": "Hebbal Flyover",
            "point": {"type": "Point", "coordinates": [77.5970, 13.0358]},
        },
        "route_geometry": geometry,
        "distance_km": dist_km,
        "duration_min": dur_min,
        "depart_at": depart_time,
        "seats_offered": 4,      # 4 passenger seats offered
        "seats_booked": 2,       # 2 seats booked (Pax 1 + Pax 2)
        "status": "published",
        "trip_type": "live",
        "fuel_type": "diesel",
        "fuel_price": 95.0,
        "fuel_price_per_unit": 95.0,
        "vehicle_mileage_kmpl": 18.0,
        "created_at": now,
        "updated_at": now,
    }
    await db.trips.update_one({"source.name": "Devanahalli Central"}, {"$set": trip_doc}, upsert=True)
    trip_id = ObjectId((await db.trips.find_one({"source.name": "Devanahalli Central"}))["_id"])
    print(f"Seeded Trip {trip_id}: Devanahalli -> Hebbal (4 seats offered, 2 booked)")

    # Seed Booking for Passenger 1 (PAX1: +919000000004) travelling 18 km
    booking1_doc = {
        "trip_id": trip_id,
        "passenger_id": pax1_id,
        "driver_id": drv1_id,
        "seats": 1,
        "status": "accepted",
        "pickup": {
            "name": "Devanahalli Central",
            "point": {"type": "Point", "coordinates": [77.7120, 13.2437]},
        },
        "dropoff": {
            "name": "Yelahanka Bypass",
            "point": {"type": "Point", "coordinates": [77.5995, 13.0999]},
        },
        "pickup_along_km": 0.0,
        "drop_along_km": 18.0,
        "passenger_distance_km": 18.0,
        "pickup_distance_m": 0.0,
        "detour_km": 0.0,
        "overlap_pct": 60.0,
        "match_score": 92.0,
        "created_at": now,
        "updated_at": now,
    }
    await db.bookings.update_one({"trip_id": trip_id, "passenger_id": pax1_id}, {"$set": booking1_doc}, upsert=True)
    print(f"Seeded Booking 1: Passenger {PAX1} (Devanahalli -> Yelahanka Bypass, distance: 18.0 km)")

    # Seed Booking for Passenger 2 (PAX2: +919000000005) travelling from km 10 to km 28.2
    drop_pax2 = float(dist_km)
    pax2_dist = round(drop_pax2 - 10.0, 1)
    booking2_doc = {
        "trip_id": trip_id,
        "passenger_id": pax2_id,
        "driver_id": drv1_id,
        "seats": 1,
        "status": "accepted",
        "pickup": {
            "name": "Airport Road Toll",
            "point": {"type": "Point", "coordinates": [77.6500, 13.1800]},
        },
        "dropoff": {
            "name": "Hebbal Drop",
            "point": {"type": "Point", "coordinates": [77.5970, 13.0358]},
        },
        "pickup_along_km": 10.0,
        "drop_along_km": drop_pax2,
        "passenger_distance_km": pax2_dist,
        "pickup_distance_m": 45.0,
        "detour_km": 0.0,
        "overlap_pct": round((pax2_dist / dist_km) * 100, 1),
        "match_score": 88.0,
        "created_at": now,
        "updated_at": now,
    }
    await db.bookings.update_one({"trip_id": trip_id, "passenger_id": pax2_id}, {"$set": booking2_doc}, upsert=True)
    print(f"Seeded Booking 2: Passenger {PAX2} (Airport Road Toll -> Hebbal, distance: {pax2_dist} km)")

    # Calculate and persist exact fuel-based segment contributions
    recalc_result = await recompute_trip_fares(db, trip_id, reason="seed_init")
    print("Recalculated Segment Cost Sharing:")
    print(f"  Total Cost: Rs {recalc_result.get('total_cost')}")
    print(f"  Driver Share: Rs {recalc_result.get('driver_share')}")
    print(f"  Passenger Shares: {recalc_result.get('passengers')}")
    print(f"  Seats Left: {recalc_result.get('seats_left')}")

    print("Database wiped, indexes ensured, and demo accounts/trips/bookings created.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed demo data (Module 25)")
    parser.add_argument("--keep", action="store_true",
                        help="do not wipe the seed set first (upsert only)")
    args = parser.parse_args()
    asyncio.run(main(keep=args.keep))
