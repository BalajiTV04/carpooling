"""Route-aware matching engine (Module 9): overlap, pickup feasibility,
destination compatibility, time compatibility. Pure Python, zero new deps.

How it works (explainable, no ML — Module 16 learns weights later):
1. Evaluate pickup and dropoff against the driver's route polyline using
   the Module 10 minimum-detour pickup optimiser.
2. FEASIBLE iff pickup_km <= max AND dropoff_km <= max AND dst_along >
   src_along (passenger travels FORWARD along the route) AND overlap >= min.
3. overlap_pct = share of the driver's route the passenger rides along.
   Also returns overlap_pct_passenger for passenger journey coverage.
4. Baseline score = 45*overlap + 25*pickup + 15*dropoff + 15*time.
"""
from typing import Any, Dict, List, Optional

from app.services.geo_math import (  # re-exported for backwards compatibility
    haversine_km,
    point_at_km,
    project_onto_route,
    route_length_km,
    seg_proj as _seg_proj,
    xy as _xy,
)
from app.services.pickup import evaluate_pickup_detour

# Baseline weights — documented for the viva; Module 16 LEARNS these.
W_OVERLAP = 0.45
W_PICKUP = 0.25
W_DROPOFF = 0.15
W_TIME = 0.15
TIME_WINDOW_MIN = 120.0
EPS_FRAC = 1e-6

WEIGHTS = {
    "overlap": W_OVERLAP,
    "pickup": W_PICKUP,
    "dropoff": W_DROPOFF,
    "time": W_TIME,
}

__all__ = [
    "WEIGHTS",
    "match_trip",
    "match_fallback",
    "project_onto_route",
    "route_length_km",
    "point_at_km",
]


def _pickup_score(pickup_km: float, max_km: float) -> float:
    if pickup_km >= max_km:
        return 0.0
    return max(0.0, 1.0 - pickup_km / max_km)


def _dropoff_score(dropoff_km: float, max_km: float) -> float:
    if dropoff_km >= max_km:
        return 0.0
    return max(0.0, 1.0 - dropoff_km / max_km)


def _time_score(time_diff_min: Optional[float]) -> float:
    if time_diff_min is None:
        return 0.6
    if time_diff_min >= TIME_WINDOW_MIN:
        return 0.0
    return max(0.0, 1.0 - time_diff_min / TIME_WINDOW_MIN)


def match_trip(
    coords: List[List[float]],
    p_pickup: List[float],
    p_dropoff: List[float],
    time_diff_min: Optional[float] = None,
    max_pickup_km: float = 3.0,
    max_detour_km: float = 5.0,
    min_overlap_pct: float = 20.0,
    pickup_snap_km: Optional[float] = None,
    dest_tolerance_km: Optional[float] = None,
    max_drop_km: Optional[float] = None,
    min_shared_km: Optional[float] = None,
    max_extra_min: Optional[float] = None,
    routing_client: Optional[Any] = None,
) -> Dict:
    """Score one trip route vs one passenger request. Full explain dict."""
    if not coords or len(coords) < 2:
        return {
            "feasible": False,
            "reason": "no route geometry",
            "routed": True,
            "route_quality": "straight_line",
            "score": 0.0,
        }

    opt = evaluate_pickup_detour(
        coords=coords,
        p_pickup=p_pickup,
        p_dropoff=p_dropoff,
        max_pickup_km=max_pickup_km,
        max_detour_km=max_detour_km,
        min_overlap_pct=min_overlap_pct,
        pickup_snap_km=pickup_snap_km,
        dest_tolerance_km=dest_tolerance_km,
        max_drop_km=max_drop_km,
        min_shared_km=min_shared_km,
        max_extra_min=max_extra_min,
        routing_client=routing_client,
    )

    pickup_km = opt["pickup_km"]
    dropoff_km = opt["dropoff_km"]
    overlap = opt["overlap_pct"]

    if opt["feasible"]:
        score = round((
            W_OVERLAP * (overlap / 100.0)
            + W_PICKUP * _pickup_score(pickup_km, max_pickup_km)
            + W_DROPOFF * _dropoff_score(dropoff_km, max_detour_km)
            + W_TIME * _time_score(time_diff_min)
        ) * 100.0, 1)
    else:
        score = 0.0

    return {
        "feasible": opt["feasible"],
        "reason": opt["reason"],
        "routed": True,
        "route_quality": "routed",
        "score": score,
        "overlap_pct": overlap,
        "overlap_pct_driver": opt["overlap_pct_driver"],
        "overlap_pct_passenger": opt["overlap_pct_passenger"],
        "passenger_overlap_pct": opt["passenger_overlap_pct"],
        "pickup_km": pickup_km,
        "dropoff_km": dropoff_km,
        "src_frac": opt["src_frac"],
        "dst_frac": opt["dst_frac"],
        "forward": opt["forward"],
        "time_diff_min": time_diff_min,
        "weights": dict(WEIGHTS),
        "pickup": opt["pickup"],
        "drop": opt["drop"],
        "passenger_distance_km": opt["passenger_distance_km"],
        "detour_km": opt["detour_km"],
        "extra_time_min": opt["extra_time_min"],
        "estimated": opt["estimated"],
        "alternatives": opt["alternatives"],
    }


def match_fallback(
    trip_src: List[float],
    trip_dst: List[float],
    p_pickup: List[float],
    p_dropoff: List[float],
    time_diff_min: Optional[float] = None,
    max_pickup_km: float = 3.0,
) -> Dict:
    """Endpoint-only estimate for offline-saved trips (routed=False)."""
    straight = [trip_src, trip_dst]
    proj_p = project_onto_route(p_pickup, straight)
    proj_d = project_onto_route(p_dropoff, straight)
    pickup_km = round(proj_p["dist_km"], 3)
    dropoff_km = round(proj_d["dist_km"], 3)
    overlap = round(max(0.0, proj_d["frac"] - proj_p["frac"]) * 100.0, 1)
    forward = (proj_d["frac"] - proj_p["frac"]) > EPS_FRAC
    feasible = pickup_km <= max_pickup_km and forward and overlap >= 20.0
    score = round((
        W_OVERLAP * (overlap / 100.0)
        + W_PICKUP * _pickup_score(pickup_km, max_pickup_km)
        + W_DROPOFF * _dropoff_score(dropoff_km, 5.0)
        + W_TIME * _time_score(time_diff_min)
    ) * 100.0, 1) if feasible else 0.0

    p_dist = round(haversine_km(p_pickup, p_dropoff), 3)

    return {
        "feasible": feasible,
        "reason": None if feasible else "estimated: weak endpoint fit",
        "routed": False,
        "route_quality": "straight_line",
        "score": score,
        "overlap_pct": overlap,
        "overlap_pct_driver": overlap,
        "overlap_pct_passenger": overlap,
        "passenger_overlap_pct": overlap,
        "pickup_km": pickup_km,
        "dropoff_km": dropoff_km,
        "src_frac": round(proj_p["frac"], 4),
        "dst_frac": round(proj_d["frac"], 4),
        "forward": forward,
        "time_diff_min": time_diff_min,
        "weights": dict(WEIGHTS),
        "pickup": {
            "lat": p_pickup[1],
            "lng": p_pickup[0],
            "label": "Estimated Pickup (straight-line)",
            "along_km": 0.0,
            "walk_km": pickup_km,
        },
        "drop": {
            "lat": p_dropoff[1],
            "lng": p_dropoff[0],
            "label": "Estimated Drop (straight-line)",
            "along_km": p_dist,
            "dest_km": dropoff_km,
            "walk_km": dropoff_km,
        },
        "passenger_distance_km": p_dist,
        "detour_km": 0.0,
        "extra_time_min": 0.0,
        "estimated": True,
        "alternatives": [],
    }
