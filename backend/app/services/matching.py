"""Route-aware matching engine (Module 9): overlap, pickup feasibility,
destination compatibility, time compatibility. Pure Python, zero new deps.

How it works (explainable, no ML — Module 16 learns weights later):
1. Project passenger pickup P and dropoff D onto the driver's route
   polyline -> nearest distances (pickup_km, dropoff_km) + positions along
   the route as fractions src_frac, dst_frac in [0, 1].
2. FEASIBLE iff pickup_km <= max AND dropoff_km <= max AND dst_frac >
   src_frac (passenger travels FORWARD along the route) AND overlap >= min.
3. overlap_pct = (dst_frac - src_frac) * 100 = share of the driver's route
   the passenger rides along. (Route-share, not journey-share: it separates
   short-hop from long-ride passengers and highlights cleanly on the map.)
4. Baseline score = 45*overlap + 25*pickup + 15*dropoff + 15*time.

Geometry lives in app/services/geo_math.py (shared with Module 10's
minimum-detour pickup optimiser) and is re-exported here so Module 9 tests
and callers keep working unchanged.
"""
from typing import Dict, List, Optional

from app.services.geo_math import (  # re-exported for backwards compatibility
    point_at_km,
    project_onto_route,
    route_length_km,
    xy as _xy,
    seg_proj as _seg_proj,
)

# Baseline weights — documented for the viva; Module 16 LEARNS these.
W_OVERLAP = 0.45
W_PICKUP = 0.25
W_DROPOFF = 0.15
W_TIME = 0.15
TIME_WINDOW_MIN = 120.0
EPS_FRAC = 1e-6

WEIGHTS = {"overlap": W_OVERLAP, "pickup": W_PICKUP,
           "dropoff": W_DROPOFF, "time": W_TIME}

__all__ = ["WEIGHTS", "match_trip", "match_fallback",
           "project_onto_route", "route_length_km", "point_at_km"]


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


def match_trip(coords: List[List[float]],
               p_pickup: List[float],
               p_dropoff: List[float],
               time_diff_min: Optional[float] = None,
               max_pickup_km: float = 3.0,
               max_detour_km: float = 5.0,
               min_overlap_pct: float = 20.0) -> Dict:
    """Score one trip route vs one passenger request. Full explain dict."""
    if not coords or len(coords) < 2:
        return {"feasible": False, "reason": "no route geometry",
                "routed": True, "score": 0.0}
    proj_p = project_onto_route(p_pickup, coords)
    proj_d = project_onto_route(p_dropoff, coords)
    pickup_km = round(proj_p["dist_km"], 3)
    dropoff_km = round(proj_d["dist_km"], 3)
    src_frac = round(proj_p["frac"], 4)
    dst_frac = round(proj_d["frac"], 4)
    forward = (dst_frac - src_frac) > EPS_FRAC
    overlap = round(max(0.0, (dst_frac - src_frac)) * 100.0, 1)
    if pickup_km > max_pickup_km:
        reason = "pickup too far ({:.1f} km > {:.0f} km)".format(pickup_km, max_pickup_km)
        return {"feasible": False, "reason": reason, "routed": True,
                "pickup_km": pickup_km, "dropoff_km": dropoff_km,
                "src_frac": src_frac, "dst_frac": dst_frac,
                "forward": forward, "overlap_pct": overlap, "score": 0.0}
    if not forward:
        return {"feasible": False, "reason": "wrong direction along route",
                "routed": True, "pickup_km": pickup_km, "dropoff_km": dropoff_km,
                "src_frac": src_frac, "dst_frac": dst_frac,
                "forward": forward, "overlap_pct": overlap, "score": 0.0}
    if overlap < min_overlap_pct:
        reason = "overlap {:.0f}% below {:.0f}% minimum".format(overlap, min_overlap_pct)
        return {"feasible": False, "reason": reason, "routed": True,
                "pickup_km": pickup_km, "dropoff_km": dropoff_km,
                "src_frac": src_frac, "dst_frac": dst_frac,
                "forward": forward, "overlap_pct": overlap, "score": 0.0}
    score = round((
        W_OVERLAP * (overlap / 100.0)
        + W_PICKUP * _pickup_score(pickup_km, max_pickup_km)
        + W_DROPOFF * _dropoff_score(dropoff_km, max_detour_km)
        + W_TIME * _time_score(time_diff_min)
    ) * 100.0, 1)
    return {
        "feasible": True, "reason": None, "routed": True,
        "score": score, "overlap_pct": overlap,
        "pickup_km": pickup_km, "dropoff_km": dropoff_km,
        "src_frac": src_frac, "dst_frac": dst_frac,
        "forward": forward, "time_diff_min": time_diff_min,
        "weights": dict(WEIGHTS),
    }


def match_fallback(trip_src: List[float], trip_dst: List[float],
                   p_pickup: List[float], p_dropoff: List[float],
                   time_diff_min: Optional[float] = None,
                   max_pickup_km: float = 3.0) -> Dict:
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
    return {
        "feasible": feasible,
        "reason": None if feasible else "estimated: weak endpoint fit",
        "routed": False, "score": score, "overlap_pct": overlap,
        "pickup_km": pickup_km, "dropoff_km": dropoff_km,
        "src_frac": round(proj_p["frac"], 4), "dst_frac": round(proj_d["frac"], 4),
        "forward": forward, "time_diff_min": time_diff_min,
        "weights": dict(WEIGHTS),
    }
