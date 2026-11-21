"""Ride search (Module 8 retrieval + Module 9 ranking + Module 16 AI re-rank).

Pipeline: filters (published/day/seats) -> window gate (M14) -> scores each
survivor with match_trip()/match_fallback() -> enrich_match() attaches the
learned AI score (logreg JSON weights, stdlib-only) -> feasible sorted by
blended = 0.5*rule + 0.5*AI; infeasible collected with reasons when
include_excluded=true. Hard gates never move: AI only re-orders feasible.
"""
from datetime import datetime, timedelta, timezone
from math import cos, radians
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query

from app.api.v1.trips import _haversine_km, _out
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.search import SearchIn
from app.services.booking_window import check_window
from app.services.cost import compute_detour_contribution, resolve_fuel_price
from app.services.matching import match_fallback, match_trip
from app.services.ranker import enrich_match, model_info

router = APIRouter(prefix="/search", tags=["search"])

TIME_WINDOW_H = 2.0


def _parse_time(date: str, hm: str):
    base = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    hh, mm = map(int, hm.split(":"))
    return base + timedelta(hours=hh, minutes=mm)


def _wanted_minutes(depart, wanted_dt):
    if wanted_dt is None:
        return None
    if depart.tzinfo is None:
        depart = depart.replace(tzinfo=timezone.utc)
    return abs((depart - wanted_dt).total_seconds()) / 60.0


@router.post("/rides")
async def search_rides(body: SearchIn, user: Dict = Depends(get_current_user)):
    _ = user  # any login (passenger AND driver — drivers ride too)
    db = get_db()
    day_start, day_end = body.day_bounds_utc()
    # Stage 1 (Mongo): published + that day. Geo + seats filter in Python
    # (dataset is small for MVP; Module 9 pushes $geoNear into the query).
    cur = db.trips.find({
        "status": {"$in": ["published", "ongoing"]},
        "depart_at": {"$gte": day_start, "$lt": day_end},
    }).sort("depart_at", 1).limit(200)
    wanted_dt = _parse_time(body.date, body.time) if body.time else None
    hits = []
    excluded = []
    async for doc in cur:
        left = int(doc.get("seats_offered", 0)) - int(doc.get("seats_booked", 0))
        if left < body.seats:
            continue
        # Module 14: hide trips whose booking window has closed (min notice)
        # or that are not open yet (max advance) — with a reason for the UI.
        win = check_window(doc["depart_at"], doc.get("advance_policy"))
        if doc.get("status") != "ongoing" and not win["bookable"]:
            row0 = {"id": str(doc["_id"]),
                    "source_name": doc["source"]["name"],
                    "destination_name": doc["destination"]["name"],
                    "reason": "window: " + (win["reason"] or "not bookable")}
            excluded.append(row0)
            continue
        try:
            s = doc["source"]["point"]["coordinates"]
            d = doc["destination"]["point"]["coordinates"]
        except (KeyError, TypeError):
            continue
        geom = (doc.get("route_geometry") or {}).get("coordinates")
        has_geom = bool(geom and len(geom) >= 2)

        src_km = _haversine_km(body.src_coordinates, s)
        dst_km = _haversine_km(body.dst_coordinates, d)

        if has_geom:
            # Spatial pre-filter: ensure passenger points are near the corridor/route bbox
            lat0 = body.src_coordinates[1]
            cos_lat = max(0.2, cos(radians(lat0)))
            margin_km = max(float(body.radius_km), float(body.max_pickup_km), 10.0)
            deg_lat = margin_km / 110.57
            deg_lng = margin_km / (111.32 * cos_lat)

            min_lng = min(pt[0] for pt in geom) - deg_lng
            max_lng = max(pt[0] for pt in geom) + deg_lng
            min_lat = min(pt[1] for pt in geom) - deg_lat
            max_lat = max(pt[1] for pt in geom) + deg_lat

            src_in = (min_lng <= body.src_coordinates[0] <= max_lng and min_lat <= body.src_coordinates[1] <= max_lat)
            dst_in = (min_lng <= body.dst_coordinates[0] <= max_lng and min_lat <= body.dst_coordinates[1] <= max_lat)
            if not (src_in and dst_in):
                continue
        else:
            if src_km > body.radius_km or dst_km > body.radius_km:
                continue

        depart = doc["depart_at"]
        tdiff = _wanted_minutes(depart, wanted_dt)
        if wanted_dt is not None and tdiff is not None and tdiff > TIME_WINDOW_H * 60:
            continue

        if has_geom:
            m = match_trip(geom, body.src_coordinates, body.dst_coordinates,
                           time_diff_min=tdiff, max_pickup_km=body.max_pickup_km,
                           max_detour_km=body.max_detour_km,
                           min_overlap_pct=body.min_overlap_pct)
        else:
            m = match_fallback(s, d, body.src_coordinates, body.dst_coordinates,
                               time_diff_min=tdiff, max_pickup_km=body.max_pickup_km)
        # Module 16: learned re-rank over the feasible set only (gates intact).
        enrich_match(m, max_pickup_km=body.max_pickup_km,
                     max_detour_km=body.max_detour_km)
        row = _out(doc)
        # Enrich with driver + vehicle info (consistent with GET /trips/available)
        driver = await db.users.find_one(
            {"_id": doc["driver_id"]},
            {"full_name": 1, "phone": 1, "rating_avg": 1, "rating_count": 1},
        )
        veh = await db.vehicles.find_one({"_id": doc.get("vehicle_id")})
        row["driver"] = {
            "name": (driver or {}).get("full_name") or "Driver",
            "rating_avg": (driver or {}).get("rating_avg"),
            "rating_count": (driver or {}).get("rating_count", 0),
        }
        row["vehicle"] = {
            "make": (veh or {}).get("make"),
            "model": (veh or {}).get("model"),
            "plate_no": (veh or {}).get("plate_no"),
            "fuel_type": (veh or {}).get("fuel_type", "petrol"),
            "mileage_kmpl": (veh or {}).get("mileage_kmpl"),
        }
        row["src_km"] = round(m.get("pickup_km", src_km), 2)
        row["dst_km"] = round(m.get("dropoff_km", dst_km), 2)
        row["match"] = m

        # Module 12: Estimated travel contribution based on passenger_distance_km
        p_dist = float(m.get("passenger_distance_km", 0.0) or 0.0)
        det_km = float(m.get("detour_km", 0.0) or 0.0)
        mileage = 15.0
        fuel_price = float(doc.get("fuel_price") or 100.0)
        fuel_type = doc.get("fuel_type") or "petrol"
        if veh:
            mileage = float(veh.get("mileage_kmpl") or 15.0)
            if not doc.get("fuel_price"):
                fuel_price = resolve_fuel_price(veh.get("fuel_type", fuel_type), doc.get("price_policy"))

        occupants = 1 + int(doc.get("seats_booked", 0) or 0) + int(body.seats)
        settings = get_settings()
        cost_info = compute_detour_contribution(
            passenger_distance_km=p_dist,
            detour_km=det_km,
            mileage_kmpl=mileage,
            fuel_price_per_litre=fuel_price,
            occupants=occupants,
            policy=getattr(settings, "COST_SPLIT_POLICY", "EQUAL_SPLIT"),
            include_detour_cost=getattr(settings, "INCLUDE_DETOUR_COST", False),
        )
        row["estimated_contribution"] = cost_info["estimated_contribution"]
        row["passenger_distance_km"] = p_dist
        row["detour_km"] = det_km
        row["extra_time_min"] = m.get("extra_time_min", 0.0)
        row["route_quality"] = m.get("route_quality", "routed")
        row["estimated"] = m.get("estimated", False)
        row["pickup"] = m.get("pickup")
        row["drop"] = m.get("drop")

        # Module 14: minutes left before booking closes (for the UI countdown)
        row["minutes_to_close"] = round(win["minutes_to_close"], 0)
        if m["feasible"]:
            hits.append(row)
        else:
            row["excluded_reason"] = m.get("reason")
            excluded.append(row)
        if len(hits) + len(excluded) >= max(body.limit * 2, body.limit):
            break
    # Module 16: blended = 0.5 * rule + 0.5 * AI; rule score is the tiebreak
    # so ordering is deterministic even when the artifact is missing.
    hits.sort(key=lambda r: (r["match"].get("blended", r["match"]["score"]),
                             r["match"]["score"]), reverse=True)
    hits = hits[:body.limit]
    out = {
        "count": len(hits),
        "time_window_h": TIME_WINDOW_H if body.time else None,
        "weights": {"overlap": 0.45, "pickup": 0.25, "dropoff": 0.15, "time": 0.15},
        "ai": model_info(),
        "results": hits,
    }
    if body.include_excluded:
        out["excluded_count"] = len(excluded)
        out["excluded"] = [{"id": e["id"], "source_name": e["source_name"],
                            "destination_name": e["destination_name"],
                            "reason": e.get("excluded_reason") or e.get("reason")}
                           for e in excluded[:body.limit]]
    return out


@router.get("/rides")
async def search_rides_get(
    src_lng: float = Query(ge=-180, le=180),
    src_lat: float = Query(ge=-90, le=90),
    dst_lng: float = Query(ge=-180, le=180),
    dst_lat: float = Query(ge=-90, le=90),
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    time_: str = Query(default="", alias="time"),
    seats: int = Query(default=1, ge=1, le=7),
    radius_km: float = Query(default=8.0, ge=0.5, le=50.0),
    limit: int = Query(default=20, ge=1, le=50),
    max_pickup_km: float = Query(default=3.0, ge=0.5, le=20.0),
    max_detour_km: float = Query(default=5.0, ge=0.5, le=30.0),
    min_overlap_pct: float = Query(default=20.0, ge=0.0, le=90.0),
    include_excluded: bool = Query(default=False),
    user: Dict = Depends(get_current_user),
):
    """GET twin of POST /rides (shareable links, matches frontend query use)."""
    body = SearchIn(
        src_coordinates=[src_lng, src_lat],
        dst_coordinates=[dst_lng, dst_lat],
        date=date,
        time=time_ or None,
        seats=seats,
        radius_km=radius_km,
        limit=limit,
        max_pickup_km=max_pickup_km,
        max_detour_km=max_detour_km,
        min_overlap_pct=min_overlap_pct,
        include_excluded=include_excluded,
    )
    return await search_rides(body, user)
