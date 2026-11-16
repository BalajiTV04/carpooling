import asyncio
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.core.database import get_db
from app.services.matching import match_trip

async def main():
    db = get_db()
    t = await db.trips.find_one({"source.name": {"$regex": "Devanahalli"}})
    geom = t["route_geometry"]["coordinates"]
    p_src = [77.5963, 13.1007]
    p_dst = [77.6200, 13.0475]
    m = match_trip(
        geom, p_src, p_dst,
        max_pickup_km=10.0,
        max_detour_km=8.0,
        dest_tolerance_km=5.0,
        max_drop_km=5.0,
        min_overlap_pct=5.0,
    )
    print("m feasible:", m["feasible"], "reason:", m["reason"])

if __name__ == "__main__":
    asyncio.run(main())
