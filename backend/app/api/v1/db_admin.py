"""DB admin (dev-only): verify Module 2 without mongosh.

POST /api/v1/db/init  -> create/refresh collections + validators + indexes
GET  /api/v1/db/stats -> per-collection counts + index names (for the UI page)
GET  /api/v1/db/schema/{collection} -> validator JSON for the explorer UI
"""
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.database import get_db
from app.core.indexes import ensure_indexes

router = APIRouter(prefix="/db", tags=["db"])

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "database" / "schemas"
COLLECTIONS = ["users", "vehicles", "trips", "bookings", "segments", "locations", "safety_alerts", "phone_otps", "recurring_groups", "ratings", "notifications"]


@router.post("/init")
async def db_init():
    import init_db

    await init_db.main()
    return {"status": "ok", "collections": COLLECTIONS}


@router.get("/stats")
async def db_stats():
    db = get_db()
    stats = {}
    existing = await db.list_collection_names()
    for name in COLLECTIONS:
        if name in existing:
            coll = db[name]
            idx = await coll.index_information()
            stats[name] = {
                "count": await coll.estimated_document_count(),
                "indexes": sorted(idx.keys()),
                "geo": sorted([k for k in idx.keys() if k.startswith("geo_")]),
            }
        else:
            stats[name] = {"count": 0, "indexes": [], "geo": [], "missing": True}
    return {"collections": stats}


@router.get("/schema/{collection}")
async def db_schema(collection: str):
    if collection not in COLLECTIONS:
        raise HTTPException(404, "unknown collection")
    import json

    path = SCHEMA_DIR / (collection + ".json")
    if not path.exists():
        raise HTTPException(404, "schema file missing")
    return json.loads(path.read_text())
