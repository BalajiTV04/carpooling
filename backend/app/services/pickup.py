"""Minimum-detour pickup point optimisation (Module 10).

Pure geometry and route evaluation engine for minimum-detour pickups,
densified polyline projection, and corridor matching.
"""
from math import cos, radians
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.core.config import get_settings
from app.services.geo_math import (
    haversine_km,
    point_at_km,
    project_onto_route,
    route_length_km,
    seg_proj,
    xy,
)

WALK_SPEED_KMPH = 4.8
CITY_SPEED_KMPH = 25.0
DEFAULT_STEP_KM = 0.4
DEFAULT_MAX_WALK_KM = 1.5
DEFAULT_WALK_WEIGHT = 0.3
REJOIN_AHEAD_KM = 0.5


def _minutes(km: float, speed_kmph: float = CITY_SPEED_KMPH) -> float:
    return round((km / speed_kmph) * 60.0, 1)


def densify_route(coords: List[List[float]], max_step_km: float = 0.1) -> Tuple[List[List[float]], List[float]]:
    """Densify route to <= max_step_km (default 0.1 km = 100 m) between points.

    Returns (densified_coords, cumulative_km_list) computed using haversine.
    All points are [lng, lat].
    """
    if not coords:
        return [], []
    if len(coords) == 1:
        return [list(coords[0])], [0.0]

    out_coords: List[List[float]] = [list(coords[0])]
    out_cum: List[float] = [0.0]
    total_km = 0.0

    for i in range(len(coords) - 1):
        a = coords[i]
        b = coords[i + 1]
        dist = haversine_km(a, b)
        if dist <= max_step_km or dist <= 1e-6:
            total_km += dist
            out_coords.append(list(b))
            out_cum.append(round(total_km, 4))
        else:
            num_steps = int(dist // max_step_km) + 1
            step_frac = 1.0 / num_steps
            for step in range(1, num_steps + 1):
                t = step * step_frac
                interp = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
                step_dist = haversine_km(out_coords[-1], interp)
                total_km += step_dist
                out_coords.append(interp)
                out_cum.append(round(total_km, 4))

    return out_coords, out_cum


def project_point(
    route: List[List[float]],
    point: List[float],
    cum_kms: Optional[List[float]] = None,
) -> Dict:
    """Project point [lng, lat] onto route segments.

    Returns {along_km, offset_km, seg_index, t, lat, lng}.
    Local equirectangular projection with cos(lat).
    """
    if not route or len(route) < 2:
        if route and len(route) == 1:
            d = haversine_km(point, route[0])
            return {
                "along_km": 0.0,
                "offset_km": round(d, 4),
                "seg_index": 0,
                "t": 0.0,
                "lat": route[0][1],
                "lng": route[0][0],
            }
        return {
            "along_km": 0.0,
            "offset_km": float("inf"),
            "seg_index": -1,
            "t": 0.0,
            "lat": point[1],
            "lng": point[0],
        }

    if cum_kms is None or len(cum_kms) != len(route):
        cum_kms = [0.0]
        cur = 0.0
        for i in range(len(route) - 1):
            cur += haversine_km(route[i], route[i + 1])
            cum_kms.append(cur)

    lat0 = point[1]
    px, py = xy(point[0], point[1], lat0)

    best_offset = float("inf")
    best_along = 0.0
    best_seg = 0
    best_t = 0.0
    best_lng, best_lat = route[0][0], route[0][1]

    for i in range(len(route) - 1):
        a = route[i]
        b = route[i + 1]
        ax, ay = xy(a[0], a[1], lat0)
        bx, by = xy(b[0], b[1], lat0)
        dist, t = seg_proj(px, py, ax, ay, bx, by)
        if dist < best_offset:
            best_offset = dist
            best_seg = i
            best_t = t
            seg_len = cum_kms[i + 1] - cum_kms[i]
            best_along = cum_kms[i] + t * seg_len
            best_lng = a[0] + t * (b[0] - a[0])
            best_lat = a[1] + t * (b[1] - a[1])

    # Haversine distance from point to the projected coordinates
    actual_offset = haversine_km(point, [best_lng, best_lat])

    return {
        "along_km": round(best_along, 4),
        "offset_km": round(actual_offset, 4),
        "seg_index": best_seg,
        "t": round(best_t, 4),
        "lat": round(best_lat, 6),
        "lng": round(best_lng, 6),
    }


def evaluate_pickup_detour(
    coords: List[List[float]],
    p_pickup: List[float],
    p_dropoff: List[float],
    max_pickup_km: Optional[float] = None,
    max_detour_km: Optional[float] = None,
    min_overlap_pct: Optional[float] = None,
    pickup_snap_km: Optional[float] = None,
    dest_tolerance_km: Optional[float] = None,
    max_drop_km: Optional[float] = None,
    min_shared_km: Optional[float] = None,
    max_extra_min: Optional[float] = None,
    routing_client: Optional[Any] = None,
) -> Dict:
    """Evaluate minimum-detour pickup and drop matching for a trip polyline.

    Pure, explainable, testable with injected routing_client.
    """
    settings = get_settings()
    snap_km = float(pickup_snap_km if pickup_snap_km is not None else settings.PICKUP_SNAP_KM)
    max_p_km = float(max_pickup_km if max_pickup_km is not None else settings.MAX_PICKUP_KM)
    dest_tol_km = float(dest_tolerance_km if dest_tolerance_km is not None else settings.DEST_TOLERANCE_KM)
    max_d_km = float(max_drop_km if max_drop_km is not None else settings.MAX_DROP_KM)
    min_s_km = float(min_shared_km if min_shared_km is not None else settings.MIN_SHARED_KM)
    max_det_km = float(max_detour_km if max_detour_km is not None else settings.MAX_DETOUR_KM)
    max_ex_min = float(max_extra_min if max_extra_min is not None else settings.MAX_EXTRA_MIN)
    min_ov_pct = float(min_overlap_pct if min_overlap_pct is not None else 20.0)

    if not coords or len(coords) < 2:
        return {
            "feasible": False,
            "reason": "no route geometry",
            "routed": True,
            "route_quality": "straight_line",
            "score": 0.0,
            "pickup": None,
            "drop": None,
            "passenger_distance_km": 0.0,
            "detour_km": 0.0,
            "extra_time_min": 0.0,
            "estimated": False,
            "alternatives": [],
        }

    # Step 1: Densify route polyline and get cumulative distances
    dense_route, cum_kms = densify_route(coords, max_step_km=0.1)
    total_km = cum_kms[-1] if cum_kms else 0.0
    if total_km <= 0:
        return {
            "feasible": False,
            "reason": "empty route",
            "routed": True,
            "route_quality": "routed",
            "score": 0.0,
            "pickup": None,
            "drop": None,
            "passenger_distance_km": 0.0,
            "detour_km": 0.0,
            "extra_time_min": 0.0,
            "estimated": False,
            "alternatives": [],
        }

    # Step 2: Project pickup point
    proj_p = project_point(dense_route, p_pickup, cum_kms)
    src_offset = proj_p["offset_km"]
    src_along = proj_p["along_km"]

    # Step 3: Project dropoff point
    proj_d = project_point(dense_route, p_dropoff, cum_kms)
    dst_offset = proj_d["offset_km"]
    dst_along = proj_d["along_km"]

    driver_dest = dense_route[-1]
    dist_to_driver_dest = haversine_km(p_dropoff, driver_dest)

    # Destination tolerance: accept if within max_drop_km OR within DEST_TOLERANCE_KM of driver destination
    dest_ok = (
        dst_offset <= max_d_km
        or dist_to_driver_dest <= dest_tol_km
    )

    # If passenger's destination is at/near driver destination, clamp along to total_km
    if dist_to_driver_dest <= dest_tol_km or dst_along >= total_km - 0.1:
        drop_along = total_km
        drop_pt = [driver_dest[0], driver_dest[1]]
        drop_dest_km = dist_to_driver_dest
    else:
        drop_along = dst_along
        drop_pt = [proj_d["lng"], proj_d["lat"]]
        drop_dest_km = dst_offset

    # Check forward direction
    forward = drop_along > src_along + min_s_km

    # Candidate evaluation for pickup
    p0_pt = [proj_p["lng"], proj_p["lat"]]
    is_estimated = False
    candidates: List[Dict] = []

    if src_offset <= snap_km:
        # On route: passenger walks the small gap, driver detour = 0
        candidates.append({
            "point": p0_pt,
            "along_km": src_along,
            "walk_km": src_offset,
            "detour_km": 0.0,
            "on_route": True,
            "strategy": "walk",
            "label": "Meeting point on route",
        })
    else:
        # Off route: driver leaves route to pick up passenger
        detour_val = 0.0
        if routing_client is not None:
            try:
                detour_val = float(routing_client(p0_pt, p_pickup))
            except Exception:
                detour_val = round(2.0 * src_offset, 3)
                is_estimated = True
        else:
            detour_val = round(2.0 * src_offset, 3)
            is_estimated = True

        candidates.append({
            "point": [p_pickup[0], p_pickup[1]],
            "along_km": src_along,
            "walk_km": 0.0,
            "detour_km": detour_val,
            "on_route": False,
            "strategy": "door",
            "label": "Door pickup",
        })
        # Alternative: walk to route point
        candidates.append({
            "point": p0_pt,
            "along_km": src_along,
            "walk_km": src_offset,
            "detour_km": 0.0,
            "on_route": True,
            "strategy": "walk",
            "label": "Walk to meeting point on route",
        })

    # Sample route points every ~200 m within max_p_km as alternatives
    step_km = 0.2
    lo = max(0.0, src_along - max_p_km)
    hi = min(drop_along - min_s_km, src_along + max_p_km)
    k = lo
    while k <= hi + 1e-6:
        if abs(k - src_along) > 0.05:
            pt = point_at_km(dense_route, k)
            if pt is not None:
                w_km = haversine_km(p_pickup, pt)
                if w_km <= max_p_km:
                    candidates.append({
                        "point": pt,
                        "along_km": k,
                        "walk_km": round(w_km, 3),
                        "detour_km": 0.0,
                        "on_route": True,
                        "strategy": "walk",
                        "label": f"Route meeting point ({k:.1f} km)",
                    })
        k += step_km

    # Feasible candidates filter: candidates within max_p_km and max_det_km
    valid_cands = [
        c for c in candidates
        if c["walk_km"] <= max_p_km and c["detour_km"] <= max_det_km
    ]
    if not valid_cands:
        valid_cands = candidates

    # Primary chosen candidate:
    # If on route, chosen is candidate 0 (on route).
    # If off route, default chosen is the door pickup with detour, and alternatives provide walk options.
    chosen = candidates[0]
    alternates = [c for c in valid_cands if c["point"] != chosen["point"]][:3]

    chosen_detour = chosen["detour_km"]
    extra_min = _minutes(chosen_detour)
    shared_km = round(max(0.0, drop_along - chosen["along_km"]), 3)

    # Journey distances
    passenger_journey_km = round(haversine_km(p_pickup, p_dropoff), 3)
    passenger_overlap_pct = (
        round((shared_km / passenger_journey_km) * 100.0, 1)
        if passenger_journey_km > 0
        else 0.0
    )
    driver_overlap_pct = (
        round((shared_km / total_km) * 100.0, 1) if total_km > 0 else 0.0
    )

    pickup_info = {
        "lat": chosen["point"][1],
        "lng": chosen["point"][0],
        "label": chosen["label"],
        "along_km": round(chosen["along_km"], 3),
        "walk_km": round(chosen["walk_km"], 3),
    }

    drop_info = {
        "lat": drop_pt[1],
        "lng": drop_pt[0],
        "label": "Driver destination" if drop_along == total_km else "Drop point on route",
        "along_km": round(drop_along, 3),
        "dest_km": round(drop_dest_km, 3),
        "walk_km": round(drop_dest_km, 3),
    }

    # Evaluate feasibility gates with specific reasons
    feasible = True
    reason = None

    if src_offset > max_p_km:
        feasible = False
        reason = f"pickup too far ({src_offset:.1f} km > {max_p_km:.0f} km)"
    elif not forward:
        feasible = False
        reason = "wrong direction along route"
    elif not dest_ok:
        feasible = False
        reason = f"destination too far ({dst_offset:.1f} km > {dest_tol_km:.0f} km max)"
    elif chosen_detour > max_det_km:
        feasible = False
        reason = f"detour {chosen_detour:.1f} km > {max_det_km:.0f} km max"
    elif extra_min > max_ex_min:
        feasible = False
        reason = f"extra time {extra_min:.1f} min > {max_ex_min:.0f} min max"
    elif passenger_overlap_pct < min_ov_pct:
        feasible = False
        reason = f"overlap {passenger_overlap_pct:.0f}% below {min_ov_pct:.0f}% minimum"

    return {
        "feasible": feasible,
        "reason": reason,
        "routed": True,
        "route_quality": "routed",
        "pickup": pickup_info,
        "drop": drop_info,
        "passenger_distance_km": shared_km,
        "detour_km": chosen_detour,
        "extra_time_min": extra_min,
        "estimated": is_estimated,
        "alternatives": alternates,
        "pickup_km": round(chosen["walk_km"], 3),
        "dropoff_km": round(drop_dest_km, 3),
        "src_frac": round(chosen["along_km"] / total_km, 4) if total_km > 0 else 0.0,
        "dst_frac": round(drop_along / total_km, 4) if total_km > 0 else 0.0,
        "forward": forward,
        "overlap_pct": driver_overlap_pct,
        "overlap_pct_driver": driver_overlap_pct,
        "overlap_pct_passenger": passenger_overlap_pct,
        "passenger_overlap_pct": passenger_overlap_pct,
        "route_total_km": round(total_km, 2),
    }


def _deviation_km(point: List[float], desired: List[float], rejoin: List[float]) -> float:
    """Extra driving for C -> desired door -> rejoin B, clamped at 0."""
    extra = (
        haversine_km(point, desired)
        + haversine_km(desired, rejoin)
        - haversine_km(point, rejoin)
    )
    return round(max(0.0, extra), 3)


def _candidates(
    coords: List[List[float]],
    lo_km: float,
    hi_km: float,
    step_km: float,
    extra_km: Optional[List[float]] = None,
) -> List[Dict]:
    """Route points from lo_km to hi_km spaced by step_km."""
    total = route_length_km(coords)
    positions = []
    k = lo_km
    while k <= hi_km + 1e-9:
        positions.append(k)
        k += step_km
    if not positions or abs(positions[-1] - hi_km) > 1e-6:
        positions.append(hi_km)
    for extra in (extra_km or []):
        if lo_km - 1e-9 <= extra <= hi_km + 1e-9:
            positions.append(extra)

    out: List[Dict] = []
    for km in sorted(positions):
        km = max(0.0, min(km, total))
        pt = point_at_km(coords, km)
        if pt is None:
            continue
        coord = [round(pt[0], 6), round(pt[1], 6)]
        if out and haversine_km(coord, out[-1]["coordinates"]) < 0.001:
            continue
        out.append({
            "km": round(km, 3),
            "frac": round(km / total, 4) if total > 0 else 0.0,
            "coordinates": coord,
        })
    return out


def optimise_pickup_point(
    coords: List[List[float]],
    desired_pickup: List[float],
    desired_dropoff: List[float],
    mode: str = "auto",
    max_walk_km: float = DEFAULT_MAX_WALK_KM,
    step_km: float = DEFAULT_STEP_KM,
    walk_weight: float = DEFAULT_WALK_WEIGHT,
    slack_frac: float = 0.15,
    max_options: int = 3,
) -> Dict:
    """Ranked meeting points for one passenger request (backwards compatible)."""
    if not coords or len(coords) < 2:
        return {
            "chosen": None,
            "alternates": [],
            "considered": 0,
            "reason": "trip has no route geometry — optimiser needs a route",
            "route_km": 0.0,
        }
    if mode not in ("auto", "walk", "door"):
        mode = "auto"

    total = route_length_km(coords)
    proj_p = project_onto_route(desired_pickup, coords)
    proj_d = project_onto_route(desired_dropoff, coords)
    join_frac, leave_frac = proj_p["frac"], proj_d["frac"]
    if leave_frac - join_frac <= 0:
        return {
            "chosen": None,
            "alternates": [],
            "considered": 0,
            "reason": "drop-off is not downstream of pickup on this route",
            "route_km": round(total, 2),
        }

    lo_km = max(0.0, (join_frac - slack_frac * (leave_frac - join_frac)) * total)
    hi_km = leave_frac * total
    cands = _candidates(
        coords, lo_km, hi_km, max(0.1, step_km), extra_km=[join_frac * total]
    )

    evaluated: List[Dict] = []
    for c in cands:
        walk_km = round(haversine_km(desired_pickup, c["coordinates"]), 3)
        rejoin = (
            point_at_km(coords, min(c["km"] + REJOIN_AHEAD_KM, total))
            or c["coordinates"]
        )
        detour_km = _deviation_km(c["coordinates"], desired_pickup, rejoin)
        walk_cost = walk_weight * walk_km
        if mode == "walk":
            strategy, cost = "walk", walk_cost
        elif mode == "door":
            strategy, cost = "door", detour_km
        else:
            strategy, cost = (
                ("walk", walk_cost) if walk_cost <= detour_km else ("door", detour_km)
            )
        evaluated.append({
            "coordinates": c["coordinates"],
            "km_from_start": c["km"],
            "frac": c["frac"],
            "walk_km": walk_km,
            "walk_min": _minutes(walk_km, WALK_SPEED_KMPH),
            "detour_km": 0.0 if strategy == "walk" else detour_km,
            "door_detour_km": detour_km,
            "detour_min": 0.0 if strategy == "walk" else _minutes(detour_km, CITY_SPEED_KMPH),
            "strategy": strategy,
            "cost": round(cost, 3),
            "walkable": walk_km <= max_walk_km,
        })

    if not evaluated:
        return {
            "chosen": None,
            "alternates": [],
            "considered": 0,
            "reason": "no candidate points along the shared segment",
            "route_km": round(total, 2),
        }

    ranked = sorted(
        evaluated, key=lambda e: (e["cost"], e["walk_km"], e["km_from_start"])
    )
    best_walk = next((e for e in evaluated if e["walkable"]), None)
    best_door = sorted(evaluated, key=lambda e: (e["door_detour_km"], e["walk_km"]))[0]
    best_door = dict(
        best_door,
        strategy="door",
        detour_km=best_door["door_detour_km"],
        detour_min=_minutes(best_door["door_detour_km"], CITY_SPEED_KMPH),
    )

    if mode == "walk":
        chosen = best_walk or best_door
    elif mode == "door":
        chosen = best_door
    else:
        chosen = ranked[0]
        if chosen["strategy"] == "walk" and not chosen["walkable"]:
            chosen = best_door

    proj_point = point_at_km(coords, join_frac * total) or desired_pickup
    proj_rejoin = (
        point_at_km(coords, min(join_frac * total + REJOIN_AHEAD_KM, total))
        or proj_point
    )
    baseline_detour = _deviation_km(proj_point, desired_pickup, proj_rejoin)

    alternates = []
    for cand in (best_walk, best_door):
        if cand is None or (
            cand["coordinates"] == chosen["coordinates"]
            and cand["strategy"] == chosen["strategy"]
        ):
            continue
        if any(a["coordinates"] == cand["coordinates"] for a in alternates):
            continue
        alternates.append(cand)
        if len(alternates) >= max_options - 1:
            break

    saved = round(max(0.0, baseline_detour - chosen["detour_km"]), 3)
    if chosen["strategy"] == "walk":
        why = "Walk {:.0f} m (≈{:.0f} min) to a point already on the route — driver detour 0 km".format(
            chosen["walk_km"] * 1000, chosen["walk_min"]
        )
    else:
        why = "Driver detours only +{:.1f} km (≈{:.0f} min) to reach your door; your walk {:.0f} m".format(
            chosen["detour_km"], chosen["detour_min"], chosen["walk_km"] * 1000
        )

    return {
        "chosen": dict(chosen, why=why),
        "alternates": alternates,
        "considered": len(evaluated),
        "step_km": step_km,
        "max_walk_km": max_walk_km,
        "walk_weight": walk_weight,
        "mode": mode,
        "route_km": round(total, 2),
        "baseline_detour_km": baseline_detour,
        "saved_detour_km": saved,
        "reason": None,
    }
