"""Init Mongo: create collections, validators, indexes. Idempotent — rerun safe.
Usage: copy backend/.env.example backend/.env then `python init_db.py`.
Validators come from database/schemas/*.json so mongosh + API never drift."""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # backend/
SCHEMA_DIR = ROOT.parent / "database" / "schemas"
sys.path.insert(0, str(ROOT))

from app.core.database import get_client  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.indexes import ensure_indexes  # noqa: E402

SCHEMA_FILES = {
    "users": "users.json",
    "vehicles": "vehicles.json",
    "trips": "trips.json",
    "bookings": "bookings.json",
    "segments": "segments.json",
    "locations": "locations.json",
    "safety_alerts": "safety_alerts.json",
    "phone_otps": "phone_otps.json",
    "recurring_groups": "recurring_groups.json",
    # Module 22/23 collections. The dev-only collection set lives in exactly
    # five places that must agree — this dict, core.indexes.INDEXES,
    # db_admin.COLLECTIONS, database/schemas/*.json and database/indexes/*.js.
    # test_db_design asserts they do; adding a collection anywhere means
    # adding it everywhere.
    "ratings": "ratings.json",
    "notifications": "notifications.json",
}


async def main() -> None:
    settings = get_settings()
    client = get_client()
    db = client[settings.MONGO_DB]
    existing = await db.list_collection_names()
    for coll_name, fname in SCHEMA_FILES.items():
        schema = json.loads((SCHEMA_DIR / fname).read_text())
        validator = {"$jsonSchema": schema["$jsonSchema"]}
        if coll_name not in existing:
            await db.create_collection(coll_name, validator=validator)
            print("created " + coll_name)
        else:
            await db.command({"collMod": coll_name, "validator": validator})
            print("validated " + coll_name)
    ensured = await ensure_indexes(db)
    print("indexes ensured: " + str(len(ensured)))
    print("DB ready: " + settings.MONGO_DB)


if __name__ == "__main__":
    asyncio.run(main())
