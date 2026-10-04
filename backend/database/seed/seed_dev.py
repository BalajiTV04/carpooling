"""Dev seed (NEVER production). Flag-guarded. Inserts: 1 driver + 1 car +
1 published trip (BLR Hebbal→Electronic City) if users is empty.
Usage: `python -m database.seed.seed_dev` from backend/ (needs .env + Mongo)."""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # backend/
sys.path.insert(0, str(ROOT))

from app.core.database import get_db  # noqa: E402


async def main() -> None:
    db = get_db()
    if await db.users.count_documents({}) > 0:
        print("seed skipped: users not empty")
        return
    now = datetime.now(timezone.utc)
    driver_id = (await db.users.insert_one({
        "phone": "+919876543210", "full_name": "Dev Driver",
        "roles": ["driver", "passenger"], "phone_verified": True,
        "rating_avg": 4.8, "rating_count": 12,
        "status": "active", "created_at": now, "updated_at": now,
    })).inserted_id
    vehicle_id = (await db.vehicles.insert_one({
        "owner_id": driver_id, "make": "Maruti", "model": "Swift",
        "plate_no": "KA05MN1234", "seats_total": 3, "fuel_type": "petrol",
        "mileage_kmpl": 18.0, "verification_status": "verified",
        "is_active": True, "created_at": now, "updated_at": now,
    })).inserted_id
    await db.trips.insert_one({
        "driver_id": driver_id, "vehicle_id": vehicle_id,
        "source": {"name": "Hebbal, Bengaluru",
                   "point": {"type": "Point", "coordinates": [77.5946, 13.0358]}},
        "destination": {"name": "Electronic City, Bengaluru",
                        "point": {"type": "Point", "coordinates": [77.6700, 12.8452]}},
        "route_geometry": None, "distance_km": 28.5, "duration_min": 55,
        "depart_at": now + timedelta(days=1),
        "seats_offered": 3, "seats_booked": 0,
        "status": "published", "created_at": now, "updated_at": now,
    })
    print("seeded: 1 driver + 1 vehicle + 1 trip")


if __name__ == "__main__":
    asyncio.run(main())
