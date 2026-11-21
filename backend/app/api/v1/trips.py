"""Trip routes (Module 6): driver publishes source/dest/date/time/seats.

Gates (checked IN ORDER, first failure wins):
1. driver role (require_roles)  2. phone verified  3. vehicle owned+active
4. vehicle verified  5. seats_offered <= vehicle.seats_total
6. depart_at in future (validator)  7. source != destination (>500m apart)

 Lifecycle: draft -> pending_approval -> published -> ongoing -> completed,
 or -> rejected/cancelled. Dashboard-hosted trips submit for an administrator's
 decision; the legacy draft -> publish endpoint remains available for staged
 trips created elsewhere in the app.
Publish is explicit (POST /{id}/publish) so drivers can stage drafts.
Edit allowed in draft/published only; lowering seats below seats_booked is
rejected (protects accepted passengers — Module 11 writes seats_booked).
Cancel allowed until ongoing; delete allowed for draft/cancelled only.

Module 7 addition: create attempts an OSRM route (best-effort, never blocks
the save). Routed trips get route_geometry + routed distance/duration;
offline trips keep crow-flies + route_geometry=None (refresh later via
POST /trips/{id}/route/refresh in geo.py).
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.trip import TripIn, TripOut, TripUpdateIn
from app.services.booking_window import normalise_policy
from app.services.cost import compute_detour_contribution, resolve_fuel_price
from app.services.cost_sharing import CONFIRMED_STATUSES, recompute_trip_fares
from app.services.geo_math import haversine_km as _haversine_km, project_onto_route
from app.services.matching import match_trip
from app.services.routing import osrm_route

router = APIRouter(prefix="/trips", tags=["trips"])
_driver = require_roles("driver")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(v: str, label: str = "trip not found") -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status.HTTP_404_NOT_FOUND, label)
    return ObjectId(v)


def _out(doc: Dict) -> Dict:
    from app.services.booking_window import normalise_policy, window

    w = window(doc["depart_at"], doc.get("advance_policy"))
    return {
        "id": str(doc["_id"]),
        "source_name": doc["source"]["name"],
        "destination_name": doc["destination"]["name"],
        "source": doc["source"],
        "destination": doc["destination"],
        "depart_at": doc["depart_at"],
        "seats_offered": doc["seats_offered"],
        "seats_booked": doc.get("seats_booked", 0),
        "seats_left": doc["seats_offered"] - doc.get("seats_booked", 0),
        "vehicle_id": str(doc["vehicle_id"]),
        "status": doc["status"],
        "distance_km": doc.get("distance_km"),
        "duration_min": doc.get("duration_min"),
        # Module 14: window is derived, never stored — one source of truth.
        "booking_opens_at": w["opens_at"].isoformat(),
        "booking_closes_at": w["closes_at"].isoformat(),
        "advance_policy": normalise_policy(doc.get("advance_policy")),
        "recurring_group_id": (str(doc["recurring_group_id"])
                               if doc.get("recurring_group_id") else None),
        "trip_type": doc.get("trip_type", "live"),
        "fuel_price": doc.get("fuel_price"),
        "fuel_type": doc.get("fuel_type"),
        "cost_per_seat": doc.get("cost_per_seat"),
        "total_cost": doc.get("total_cost"),
        "monthly_cost": doc.get("monthly_cost"),
        "approval_note": doc.get("approval_note"),
        "approved_at": doc.get("approved_at"),
        "approved_by": (str(doc["approved_by"])
                        if doc.get("approved_by") else None),
        "created_at": doc.get("created_at"),
    }


async def _checked_vehicle(db, vehicle_id: str, user_id: str) -> Dict:
    veh = await db.vehicles.find_one(
        {"_id": _oid(vehicle_id, "vehicle not found"),
         "owner_id": ObjectId(user_id)})
    if veh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    if not veh.get("is_active", True):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "vehicle is deactivated")
    if veh.get("verification_status") != "verified":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "vehicle not verified — admin approval needed")
    return veh


@router.post("", response_model=TripOut, status_code=201)
async def create_trip(body: TripIn, user: Dict = Depends(_driver)):
    if not user.get("phone_verified"):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "verify phone before publishing trips")
    db = get_db()
    veh = await _checked_vehicle(db, body.vehicle_id, user["id"])
    if body.seats_offered > int(veh.get("seats_total", 1)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "seats_offered exceeds vehicle capacity "
                            + str(veh.get("seats_total")))
    dist = _haversine_km(body.source.coordinates, body.destination.coordinates)
    if dist < 0.5:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "source and destination too close (<500m)")
    now = _utcnow()
    # Module 7: best-effort OSRM route. Failure keeps crow-flies + None
    # geometry — the save MUST NOT fail because routing is down.
    routed = await osrm_route(body.source.coordinates, body.destination.coordinates)
    distance = routed["distance_km"] if routed else round(dist, 2)
    duration = routed["duration_min"] if routed else None

    # Amount calculation based on fuel price, vehicle mileage, and distance
    mileage = float(veh.get("mileage_kmpl") or 15.0)
    fuel_price = float(body.fuel_price_per_unit) if (body.fuel_price_per_unit and body.fuel_price_per_unit > 0) else resolve_fuel_price(body.fuel_type or veh.get("fuel_type", "petrol"), None)
    litres = (distance / mileage) if mileage > 0 else 0.0
    total_cost = round(litres * fuel_price, 2)
    cost_per_seat = round(total_cost / body.seats_offered, 2) if body.seats_offered > 0 else total_cost
    monthly_cost = round(total_cost * 30, 2)  # Full month calculation (30 days commute)

    fuel_unit = "L"
    ft = (veh.get("fuel_type") or body.fuel_type or "petrol").lower()
    if ft == "cng":
        fuel_unit = "kg"
    elif ft == "ev":
        fuel_unit = "kWh"

    policy = {
        "mode": "per_seat",
        "fuel_price": fuel_price,
        "fuel_type": body.fuel_type or veh.get("fuel_type", "petrol"),
        "mileage_kmpl": mileage,
        "total_cost": total_cost,
        "cost_per_seat": cost_per_seat,
        "monthly_cost": monthly_cost,
        "trip_type": body.trip_type or "live",
    }

    doc = {
        "driver_id": ObjectId(user["id"]),
        "vehicle_id": veh["_id"],
        "source": body.source.to_place(),
        "destination": body.destination.to_place(),
        "route_geometry": routed["geometry"] if routed else None,
        "distance_km": distance,
        "duration_min": duration,
        "depart_at": body.depart_at,
        "seats_offered": body.seats_offered,
        "seats_booked": 0,
        "price_policy": policy,
        "trip_type": body.trip_type or "live",
        "fuel_price": fuel_price,
        "fuel_price_per_unit": fuel_price,
        "fuel_type": body.fuel_type or veh.get("fuel_type", "petrol"),
        "fuel_unit": fuel_unit,
        "vehicle_mileage_kmpl": mileage,
        "passenger_seats": int(veh.get("seat_capacity", 4)) - 1,
        "cost_per_seat": cost_per_seat,
        "total_cost": total_cost,
        "monthly_cost": monthly_cost,
        # Module 14: normalised window policy (defaults from Settings).
        "advance_policy": normalise_policy(body.advance_policy),
        # Module 15: recurrence tag set by /recurring; standalone trips None.
        "recurring_group_id": None,
        "status": "draft",
        "created_at": now,
        "updated_at": now,
    }
    res = await db.trips.insert_one(doc)
    created = await db.trips.find_one({"_id": res.inserted_id})
    return _out(created)


# Known landmarks in Bengaluru corridor for fast name-to-coordinate resolution
_KNOWN_PLACES: Dict[str, Tuple[float, float]] = {
    "sir m visvesvarayya": (13.1506, 77.6080),
    "visvesvarayya": (13.1506, 77.6080),
    "mvit": (13.1506, 77.6080),
    "ksr": (12.9781, 77.5695),
    "railway stn": (12.9781, 77.5695),
    "railway station": (12.9781, 77.5695),
    "bengaluru railway": (12.9781, 77.5695),
    "majestic": (12.9781, 77.5695),
    "hebbal": (13.0358, 77.5946),
    "yelahanka": (13.1007, 77.5963),
    "electronic city": (12.8452, 77.6700),
    "whitefield": (12.9698, 77.7500),
    "koramangala": (12.9352, 77.6245),
    "indiranagar": (12.9784, 77.6408),
    "kempegowda airport": (13.1986, 77.7066),
    "airport": (13.1986, 77.7066),
    "devanahalli": (13.2437, 77.7120),
    "mg road": (12.9757, 77.6095),
    "hsr": (12.9116, 77.6474),
    "btm": (12.9166, 77.6136),
    "jayanagar": (12.9250, 77.5535),
    "rajajinagar": (12.9915, 77.5518),
    "yeshwanthpur": (13.0294, 77.5546),
    "marathahalli": (12.9581, 77.7011),
    "banashankari": (12.9250, 77.5665),
    "malleswaram": (13.0035, 77.5700),
    "vidhana soudha": (12.9794, 77.5599),
    "sarjapur": (12.9081, 77.7832),
    "hosur road": (12.8459, 77.7710),
    "tumkur road": (13.0600, 77.4890),
    "mekhri": (13.0078, 77.5855),
    "silk board": (12.9177, 77.6226),
    "bellandur": (12.9304, 77.6778),
    "manyata": (13.0489, 77.6208),
    "kalyan nagar": (13.0280, 77.6429),
}


def _resolve_place_coords(q: Optional[str]) -> Optional[Tuple[float, float]]:
    if not q or not q.strip():
        return None
    ql = q.strip().lower()
    for key, (lat, lng) in _KNOWN_PLACES.items():
        if key in ql:
            return (lat, lng)
    return None


@router.get("/available")
async def list_available_trips(
    destination: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    trip_type: Optional[str] = Query(default=None),
    src_lat: Optional[float] = Query(default=None),
    src_lng: Optional[float] = Query(default=None),
    dst_lat: Optional[float] = Query(default=None),
    dst_lng: Optional[float] = Query(default=None),
    radius_km: float = Query(default=10.0),
    user: Dict = Depends(get_current_user),
):
    """Available trips for passengers: see availability filtered by destination/type,
    with corridor matching and proximity support for intermediate/on-route points.
    Includes both 'published' and active 'ongoing' trips that have seats left.
    """
    _ = user
    db = get_db()

    destination = destination if isinstance(destination, str) else None
    source = source if isinstance(source, str) else None
    trip_type = trip_type if isinstance(trip_type, str) else None
    src_lat = float(src_lat) if isinstance(src_lat, (int, float)) else None
    src_lng = float(src_lng) if isinstance(src_lng, (int, float)) else None
    dst_lat = float(dst_lat) if isinstance(dst_lat, (int, float)) else None
    dst_lng = float(dst_lng) if isinstance(dst_lng, (int, float)) else None
    radius_km = float(radius_km) if isinstance(radius_km, (int, float)) else 10.0

    # Passengers can book published trips AND active ongoing trips with open seats
    q: Dict = {"status": {"$in": ["published", "ongoing"]}}
    if trip_type and trip_type.lower() != "all":
        q["trip_type"] = trip_type.lower()

    # Fast fallback resolution from place names to coordinates
    if src_lat is None and source:
        sc = _resolve_place_coords(source)
        if sc:
            src_lat, src_lng = sc

    if dst_lat is None and destination:
        dc = _resolve_place_coords(destination)
        if dc:
            dst_lat, dst_lng = dc

    has_src = src_lat is not None and src_lng is not None
    has_dst = dst_lat is not None and dst_lng is not None

    cur = db.trips.find(q).sort("depart_at", 1).limit(100)
    results = []
    async for d in cur:
        left = int(d.get("seats_offered", 1)) - int(d.get("seats_booked", 0))
        if left <= 0:
            continue

        try:
            driver_s = d["source"]["point"]["coordinates"]
            driver_d = d["destination"]["point"]["coordinates"]
        except (KeyError, TypeError):
            continue

        geom = (d.get("route_geometry") or {}).get("coordinates")
        if not geom or len(geom) < 2:
            geom = [driver_s, driver_d]
        has_geom = bool(geom and len(geom) >= 2)

        p_src = [src_lng, src_lat] if has_src else None
        p_dst = [dst_lng, dst_lat] if has_dst else None

        match_info = None

        if has_src and has_dst:
            # Full corridor matching: allows pickup and dropoff anywhere along driver's route
            m = match_trip(
                geom, p_src, p_dst,
                max_pickup_km=max(radius_km, 15.0),
                max_detour_km=max(radius_km, 15.0),
                dest_tolerance_km=max(radius_km, 15.0),
                max_drop_km=max(radius_km, 15.0),
                min_overlap_pct=2.0,
            )
            if m.get("feasible"):
                match_info = m
            else:
                # Proximity fallback along route polyline:
                # If both passenger pickup & drop are within corridor margin of the route and moving forward
                proj_s = project_onto_route(p_src, geom)
                proj_d = project_onto_route(p_dst, geom)
                if (proj_s["dist_km"] <= max(radius_km, 15.0) and
                    proj_d["dist_km"] <= max(radius_km, 15.0) and
                    proj_d["along_km"] >= proj_s["along_km"]):
                    match_info = m
                    match_info["feasible"] = True
                elif (_haversine_km(p_src, driver_s) <= max(radius_km, 15.0) and
                      _haversine_km(p_dst, driver_d) <= max(radius_km, 15.0)):
                    match_info = m
                    match_info["feasible"] = True

            if not match_info or not match_info.get("feasible"):
                continue

        elif has_dst and not has_src:
            # Destination matching (near driver destination OR along driver corridor)
            dst_match = False
            proj_dst = project_onto_route(p_dst, geom)
            if _haversine_km(p_dst, driver_d) <= max(radius_km, 15.0) or proj_dst["dist_km"] <= max(radius_km, 15.0):
                dst_match = True

            if not dst_match and destination and destination.strip():
                dest_q = destination.strip().lower()
                trip_dest = (d.get("destination", {}).get("name", "")).lower()
                trip_src = (d.get("source", {}).get("name", "")).lower()
                if dest_q in trip_dest or dest_q in trip_src or trip_dest in dest_q:
                    dst_match = True

            if not dst_match:
                continue

        elif has_src and not has_dst:
            # Source matching (near driver source OR along driver corridor)
            src_match = False
            proj_src = project_onto_route(p_src, geom)
            if _haversine_km(p_src, driver_s) <= max(radius_km, 15.0) or proj_src["dist_km"] <= max(radius_km, 15.0):
                src_match = True

            if not src_match and source and source.strip():
                src_q = source.strip().lower()
                trip_src = (d.get("source", {}).get("name", "")).lower()
                trip_dest = (d.get("destination", {}).get("name", "")).lower()
                if src_q in trip_src or src_q in trip_dest or trip_src in src_q:
                    src_match = True

            if not src_match:
                continue

        elif not has_src and not has_dst:
            # Text-only query fallback when coordinates couldn't be resolved
            if destination and destination.strip():
                dest_q = destination.strip().lower()
                trip_dest = (d.get("destination", {}).get("name", "")).lower()
                trip_src = (d.get("source", {}).get("name", "")).lower()
                if dest_q not in trip_dest and dest_q not in trip_src and trip_dest not in dest_q:
                    continue
            if source and source.strip():
                src_q = source.strip().lower()
                trip_src = (d.get("source", {}).get("name", "")).lower()
                trip_dest = (d.get("destination", {}).get("name", "")).lower()
                if src_q not in trip_src and src_q not in trip_dest and trip_src not in src_q:
                    continue

        row = _out(d)
        driver = await db.users.find_one(
            {"_id": d["driver_id"]},
            {"full_name": 1, "phone": 1, "rating_avg": 1, "rating_count": 1}
        )
        veh = await db.vehicles.find_one({"_id": d["vehicle_id"]})
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

        # If corridor match details are available, attach them and compute contribution
        if match_info:
            p_dist = float(match_info.get("passenger_distance_km") or 0.0)
            det_km = float(match_info.get("detour_km") or 0.0)
            row["passenger_distance_km"] = round(p_dist, 2) if p_dist > 0 else None
            row["detour_km"] = round(det_km, 2)
            row["extra_time_min"] = match_info.get("extra_time_min", 0.0)
            pu = match_info.get("pickup")
            if pu:
                row["pickup"] = {
                    "lat": pu.get("lat"),
                    "lng": pu.get("lng"),
                    "label": pu.get("label"),
                    "coordinates": [pu.get("lng"), pu.get("lat")],
                }
            dr = match_info.get("drop")
            if dr:
                row["drop"] = {
                    "lat": dr.get("lat"),
                    "lng": dr.get("lng"),
                    "label": dr.get("label"),
                    "coordinates": [dr.get("lng"), dr.get("lat")],
                }
            row["match_score"] = match_info.get("score")

            mileage = float((veh or {}).get("mileage_kmpl") or 15.0)
            fuel_price = float(d.get("fuel_price") or 100.0)
            if not d.get("fuel_price"):
                fuel_price = resolve_fuel_price((veh or {}).get("fuel_type", "petrol"), d.get("price_policy"))

            occupants = 1 + int(d.get("seats_booked", 0) or 0) + 1
            cost_res = compute_detour_contribution(
                passenger_distance_km=p_dist if p_dist > 0 else float(d.get("distance_km") or 0.0),
                detour_km=det_km,
                mileage_kmpl=mileage,
                fuel_price_per_litre=fuel_price,
                occupants=occupants,
            )
            row["estimated_contribution"] = cost_res.get("estimated_contribution")
            if cost_res.get("estimated_contribution"):
                row["cost_per_seat"] = cost_res.get("estimated_contribution")

        results.append(row)
    return results


# Module 25: `/mine` is declared ABOVE `/{trip_id}` ON PURPOSE. FastAPI matches
# routes in registration order, so a `/{trip_id}` route defined first swallows
# the literal string "mine" as a trip id and the driver's My Trips page returns
# 404 "trip not found" with no other symptom. test_deploy asserts this ordering
# for every router in the project.
@router.get("/mine", response_model=List[TripOut])
async def list_my_trips(
    user: Dict = Depends(_driver),
    status_: str = Query(default=""),
):
    """My trips, soonest first. Optional ?status= filter."""
    db = get_db()
    q = {"driver_id": ObjectId(user["id"])}  # type: Dict
    if status_:
        if status_ not in ("draft", "pending_approval", "published", "ongoing",
                           "completed", "rejected", "cancelled"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad status filter")
        q["status"] = status_
    cur = db.trips.find(q).sort("depart_at", 1)
    return [_out(d) async for d in cur]


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(trip_id: str, user: Dict = Depends(get_current_user)):
    _ = user  # any logged-in user may view (passengers need this for search M8)
    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    return _out(doc)


@router.patch("/{trip_id}", response_model=TripOut)
async def update_trip(trip_id: str, body: TripUpdateIn, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] not in ("draft", "published"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only draft/published trips can be edited")
    patch = {}
    if body.source is not None:
        patch["source"] = body.source.to_place()
    if body.destination is not None:
        patch["destination"] = body.destination.to_place()
    if body.depart_at is not None:
        patch["depart_at"] = body.depart_at
    if body.seats_offered is not None:
        if body.seats_offered < int(doc.get("seats_booked", 0)):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "cannot offer fewer seats than already booked")
        veh = await db.vehicles.find_one({"_id": doc["vehicle_id"]})
        cap = int(veh.get("seats_total", 7)) if veh else 7
        if body.seats_offered > cap:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "seats_offered exceeds vehicle capacity " + str(cap))
        patch["seats_offered"] = body.seats_offered

    if body.fuel_price_per_unit is not None:
        # Fuel price locked once any booking is accepted (config).
        if get_settings().LOCK_FUEL_PRICE_AFTER_ACCEPT:
            existing = await db.bookings.find_one({
                "trip_id": doc["_id"],
                "status": {"$in": list(CONFIRMED_STATUSES)},
            })
            if existing is not None:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    "fuel price is locked after a booking is accepted")
        if body.fuel_price_per_unit <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "fuel price must be greater than 0")
        patch["fuel_price_per_unit"] = body.fuel_price_per_unit
        patch["fuel_price"] = body.fuel_price_per_unit
    if ("source" in patch) or ("destination" in patch):
        src = patch.get("source", doc["source"])
        dst = patch.get("destination", doc["destination"])
        if _haversine_km(src["point"]["coordinates"], dst["point"]["coordinates"]) < 0.5:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "source and destination too close (<500m)")
        patch["distance_km"] = round(_haversine_km(
            src["point"]["coordinates"], dst["point"]["coordinates"]), 2)
        patch["route_geometry"] = None  # endpoints moved -> re-route in Module 7
    if not patch:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nothing to update")
    patch["updated_at"] = _utcnow()
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]}, {"$set": patch}, return_document=True)
    # Recompute fares when route, fuel price, or seats changed.
    recompute_keys = {"route_km", "fuel_price_per_unit", "fuel_price",
                      "seats_offered", "distance_km", "route_geometry"}
    if any(k in patch for k in recompute_keys):
        await recompute_trip_fares(db, doc["_id"], reason="trip_updated")
    return _out(updated)


@router.post("/{trip_id}/publish", response_model=TripOut)
async def publish_trip(trip_id: str, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] != "draft":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only drafts can be published")
    # Re-check gates at publish time (vehicle may have been edited/rejected).
    if not user.get("phone_verified"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "verify phone first")
    await _checked_vehicle(db, str(doc["vehicle_id"]), user["id"])
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"status": "published", "updated_at": _utcnow()}},
        return_document=True)
    return _out(updated)


@router.post("/{trip_id}/submit-approval", response_model=TripOut)
async def submit_trip_for_approval(trip_id: str, user: Dict = Depends(_driver)):
    """Submit a staged trip to the admin queue instead of exposing it directly.

    Only a draft can be submitted. Passenger search only includes `published`,
    so the route remains private until an administrator approves it.
    """
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] != "draft":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only drafts can be submitted for approval")
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"], "status": "draft"},
        {"$set": {"status": "pending_approval", "approval_note": None,
                  "approved_at": None, "approved_by": None,
                  "updated_at": _utcnow()}},
        return_document=True)
    if updated is None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "trip changed state while submitting")
    try:
        from app.api.v1.notifications import emit
        route = "{} → {}".format(doc["source"]["name"], doc["destination"]["name"])
        await emit(db, "trip_approval_requested", actor_id=user["id"],
                   trip_id=str(doc["_id"]), route=route, _trip=updated)
    except Exception as exc:
        import logging
        logging.warning(
            "notification emit failed for trip_approval_requested: %s: %s",
            type(exc).__name__, exc
        )
    return _out(updated)


@router.post("/{trip_id}/cancel", response_model=TripOut)
async def cancel_trip(trip_id: str, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] in ("ongoing", "completed", "cancelled"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "cannot cancel " + doc["status"] + " trip")
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"status": "cancelled", "updated_at": _utcnow()}},
        return_document=True)
    return _out(updated)


@router.delete("/{trip_id}")
async def delete_trip(trip_id: str, user: Dict = Depends(_driver)):
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] not in ("draft", "rejected", "cancelled"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only draft/rejected/cancelled trips can be deleted")
    await db.trips.delete_one({"_id": doc["_id"]})
    return {"deleted": True, "id": str(doc["_id"])}


@router.get("/{trip_id}/bookability")
async def trip_bookability(trip_id: str, user: Dict = Depends(get_current_user)):
    """Module 14: can passengers book this trip right now, and why/why not."""
    _ = user
    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    from app.services.booking_window import check_window

    result = check_window(doc["depart_at"], doc.get("advance_policy"))
    result["trip"] = {"id": str(doc["_id"]), "status": doc["status"],
                      "seats_left": doc["seats_offered"] - doc.get("seats_booked", 0)}
    return result


@router.post("/{trip_id}/advance-policy", response_model=TripOut)
async def set_advance_policy(
    trip_id: str,
    max_days_advance: int = Query(default=30, ge=1, le=180),
    min_notice_min: int = Query(default=60, ge=0, le=1440),
    user: Dict = Depends(_driver),
):
    """Owner-only window tuning (Module 14). Applies to draft/published trips;
    ongoing/completed/cancelled are immutable."""
    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if str(doc["driver_id"]) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your trip")
    if doc["status"] not in ("draft", "published"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "window is fixed once the trip is " + doc["status"])
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"advance_policy": normalise_policy({
            "max_days_advance": max_days_advance,
            "min_notice_min": min_notice_min}),
            "updated_at": _utcnow()}},
        return_document=True)
    return _out(updated)


# ---------------------------------------------------------------------------
# Module 19: trip start / completion / receipt (closes the lifecycle)
# ---------------------------------------------------------------------------
@router.post("/{trip_id}/start", response_model=TripOut)
async def start_trip(trip_id: str, user: Dict = Depends(_driver)):
    """Explicit published -> ongoing. Tracking's first ping does this too; this
    route exists so a driver can start without sharing location yet."""
    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    if doc["status"] != "published":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "only published trips can be started ("
                            + str(doc["status"]) + ")")
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"], "status": "published"},
        {"$set": {"status": "ongoing", "started_at": _utcnow(),
                  "updated_at": _utcnow()}},
        return_document=True)
    if updated is None:  # lost a race with another start/ping
        updated = await db.trips.find_one({"_id": doc["_id"]})
    return _out(updated)


@router.post("/{trip_id}/complete")
async def complete_trip(trip_id: str, user: Dict = Depends(_driver)):
    """Driver closes the ride: published|ongoing -> completed.

    One atomic-ish sequence (all idempotent on retry):
    1. guard the transition (Module 19 rules);
    2. persist final segments/cost_shares while the trip is still open, so the
       receipt prices what actually happened (Modules 12/13);
    3. resolve every open booking (requested -> rejected, accepted/confirmed ->
       completed) — seats are FROZEN, nothing is released;
    4. stamp completed_at and return the receipt.
    """
    from app.services.lifecycle import completion_guard, resolve_completion, summarise

    db = get_db()
    doc = await db.trips.find_one(
        {"_id": _oid(trip_id), "driver_id": ObjectId(user["id"])})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    guard = completion_guard(doc.get("status"))
    if not guard["allowed"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, guard["reason"])

    # 2. final money pass BEFORE flipping the status (segments endpoint refuses
    #    completed trips, which is exactly the freeze we want afterwards).
    from app.api.v1.segments import persist_segments

    segments = await persist_segments(db, doc)

    # 3. resolve bookings
    now = _utcnow()
    open_docs = await db.bookings.find({
        "trip_id": doc["_id"],
        "status": {"$in": ["requested", "accepted", "confirmed"]}}).to_list(200)
    plan = resolve_completion(open_docs)
    for t in plan["transitions"]:
        await db.bookings.update_one(
            {"_id": ObjectId(t["id"]), "status": t["from"]},
            {"$set": {"status": t["to"], "closed_at": now, "updated_at": now,
                      **({"closure_note": t["note"]} if t.get("note") else {})}})

    # 4. flip the trip (conditional: a concurrent cancel wins the race)
    updated = await db.trips.find_one_and_update(
        {"_id": doc["_id"], "status": {"$in": list(("published", "ongoing"))}},
        {"$set": {"status": "completed", "completed_at": now,
                  "updated_at": now}},
        return_document=True)
    if updated is None:
        fresh = await db.trips.find_one({"_id": doc["_id"]})
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "trip changed state while completing (now "
                            + str((fresh or {}).get("status")) + ")")

    final_bookings = await db.bookings.find(
        {"trip_id": doc["_id"]}).to_list(200)
    receipt = summarise(updated, final_bookings, plan)
    receipt["segments_persisted"] = segments

    # Module 23: every rider is nudged to leave a rating (Module 22 consumes
    # exactly this). Best-effort — never blocks the receipt.
    try:
        from app.api.v1.notifications import emit  # lazy: avoids a router cycle

        for b in final_bookings:
            if b.get("status") == "completed":
                await emit(db, "trip_completed", actor_id=user["id"],
                           booking_id=str(b["_id"]), trip_id=str(doc["_id"]),
                           driver=doc.get("driver_name") or "your driver",
                           _booking=b, _trip=updated)
    except Exception:
        pass
    return receipt


@router.get("/{trip_id}/summary")
async def trip_summary(trip_id: str, user: Dict = Depends(get_current_user)):
    """Post-trip receipt for the driver + every passenger who rode (or still
    holds a booking on) the trip. Read-only — never recomputes money."""
    from app.services.lifecycle import summarise

    db = get_db()
    doc = await db.trips.find_one({"_id": _oid(trip_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    is_driver = str(doc["driver_id"]) == user["id"]
    if not is_driver:
        held = await db.bookings.find_one({
            "trip_id": doc["_id"], "passenger_id": ObjectId(user["id"]),
            "status": {"$in": ["requested", "accepted", "confirmed",
                               "completed"]}})
        if held is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "not a party to this trip")
    bookings = await db.bookings.find({"trip_id": doc["_id"]}).to_list(200)
    receipt = summarise(doc, bookings)
    receipt["completed"] = doc.get("status") == "completed"
    if not receipt["completed"]:
        receipt["note"] = ("Trip is " + str(doc.get("status"))
                           + " — numbers are provisional until completion.")
    return receipt
