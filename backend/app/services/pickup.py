"""Minimum-detour pickup point optimisation (Module 10).

THE IDEA
Both extremes are bad: dropping the passenger exactly at their door costs the
driver a deviation; forcing them to the route's nearest point may mean a long
walk. So we search along the route for the meeting point that minimises

    cost = detour_km  +  walk_weight * walk_km

WHY THE DEVIATION FORMULA IS |C→P| + |P→B| − |C→B|
If the driver leaves the route at C, collects the passenger at their door P and
rejoins downstream at B, the extra distance driven is exactly that triangle
expression (0 when P sits on the segment). Straight-line legs are a documented
estimate (same doctrine as Module 9) — no per-candidate OSRM calls, so
optimising stays instant and explainable.

STRATEGIES
- "walk": passenger walks to the route point → driver detour 0, ranked by walk.
- "door": driver deviates to the door → ranked by deviation.
- "auto": both evaluated per candidate; cheaper wins (100 m walk beats a 2 km
  detour, but a 2 km walk loses to a 400 m detour).

HARD RULE (route feasibility before comfort/detour)
Candidates must sit between the passenger's projected join point (minus small
slack) and their projected leave point, so the optimiser can never propose a
pickup that makes the driver drive backwards.
"""
from typing import Dict, List

from app.services.geo_math import (
    haversine_km,
    point_at_km,
    project_onto_route,
    route_length_km,
)

WALK_SPEED_KMPH = 4.8
CITY_SPEED_KMPH = 25.0
DEFAULT_STEP_KM = 0.4
DEFAULT_MAX_WALK_KM = 1.5
DEFAULT_WALK_WEIGHT = 0.3
REJOIN_AHEAD_KM = 0.5


def _minutes(km: float, speed_kmph: float) -> float:
    return round((km / speed_kmph) * 60.0, 1)


def _deviation_km(point: List[float], desired: List[float],
                  rejoin: List[float]) -> float:
    """Extra driving for C -> desired door -> rejoin B, clamped at 0."""
    extra = (haversine_km(point, desired)
             + haversine_km(desired, rejoin)
             - haversine_km(point, rejoin))
    return round(max(0.0, extra), 3)


def _candidates(coords: List[List[float]], lo_km: float, hi_km: float,
                step_km: float, extra_km: List[float] = None) -> List[Dict]:
    """Route points from lo_km to hi_km spaced by step_km, PLUS any extra
    positions (the passenger's exact projection foot — that's where walking is
    shortest, so the grid alone would never report a 0 m walk)."""
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
            continue  # sub-metre duplicate
        out.append({"km": round(km, 3),
                    "frac": round(km / total, 4) if total > 0 else 0.0,
                    "coordinates": coord})
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
    """Ranked meeting points for one passenger request (pure, sync, testable)."""
    if not coords or len(coords) < 2:
        return {"chosen": None, "alternates": [], "considered": 0,
                "reason": "trip has no route geometry — optimiser needs a route",
                "route_km": 0.0}
    if mode not in ("auto", "walk", "door"):
        mode = "auto"

    total = route_length_km(coords)
    proj_p = project_onto_route(desired_pickup, coords)
    proj_d = project_onto_route(desired_dropoff, coords)
    join_frac, leave_frac = proj_p["frac"], proj_d["frac"]
    if leave_frac - join_frac <= 0:
        return {"chosen": None, "alternates": [], "considered": 0,
                "reason": "drop-off is not downstream of pickup on this route",
                "route_km": round(total, 2)}

    lo_km = max(0.0, (join_frac - slack_frac * (leave_frac - join_frac)) * total)
    hi_km = leave_frac * total
    cands = _candidates(coords, lo_km, hi_km, max(0.1, step_km),
                        extra_km=[join_frac * total])

    evaluated: List[Dict] = []
    for c in cands:
        walk_km = round(haversine_km(desired_pickup, c["coordinates"]), 3)
        rejoin = point_at_km(coords, min(c["km"] + REJOIN_AHEAD_KM, total)) or c["coordinates"]
        detour_km = _deviation_km(c["coordinates"], desired_pickup, rejoin)
        walk_cost = walk_weight * walk_km
        if mode == "walk":
            strategy, cost = "walk", walk_cost
        elif mode == "door":
            strategy, cost = "door", detour_km
        else:
            strategy, cost = ("walk", walk_cost) if walk_cost <= detour_km else ("door", detour_km)
        evaluated.append({
            "coordinates": c["coordinates"],
            "km_from_start": c["km"],
            "frac": c["frac"],
            "walk_km": walk_km,
            "walk_min": _minutes(walk_km, WALK_SPEED_KMPH),
            # detour_km is what the DRIVER pays under this strategy:
            # 0 for "walk" (they never leave the route), the deviation for "door".
            "detour_km": 0.0 if strategy == "walk" else detour_km,
            "door_detour_km": detour_km,
            "detour_min": 0.0 if strategy == "walk" else _minutes(detour_km, CITY_SPEED_KMPH),
            "strategy": strategy,
            "cost": round(cost, 3),
            "walkable": walk_km <= max_walk_km,
        })

    if not evaluated:
        return {"chosen": None, "alternates": [], "considered": 0,
                "reason": "no candidate points along the shared segment",
                "route_km": round(total, 2)}

    ranked = sorted(evaluated, key=lambda e: (e["cost"], e["walk_km"], e["km_from_start"]))
    best_walk = next((e for e in evaluated if e["walkable"]), None)
    best_door = sorted(evaluated, key=lambda e: (e["door_detour_km"], e["walk_km"]))[0]
    # A "walk" strategy means the passenger adds no distance for the driver, so
    # when we fall back to door pickup we must report the real deviation cost.
    best_door = dict(best_door, strategy="door",
                     detour_km=best_door["door_detour_km"],
                     detour_min=_minutes(best_door["door_detour_km"], CITY_SPEED_KMPH))

    if mode == "walk":
        chosen = best_walk or best_door
    elif mode == "door":
        chosen = best_door
    else:
        chosen = ranked[0]
        if chosen["strategy"] == "walk" and not chosen["walkable"]:
            chosen = best_door

    # Baseline: cost if the passenger insisted on door pickup exactly at their
    # projected point (i.e. no optimisation) — powers the "saves X km" claim.
    proj_point = point_at_km(coords, join_frac * total) or desired_pickup
    proj_rejoin = point_at_km(coords, min(join_frac * total + REJOIN_AHEAD_KM, total)) or proj_point
    baseline_detour = _deviation_km(proj_point, desired_pickup, proj_rejoin)

    alternates = []
    for cand in (best_walk, best_door):
        if cand is None or (cand["coordinates"] == chosen["coordinates"]
                            and cand["strategy"] == chosen["strategy"]):
            continue
        if any(a["coordinates"] == cand["coordinates"] for a in alternates):
            continue
        alternates.append(cand)
        if len(alternates) >= max_options - 1:
            break

    saved = round(max(0.0, baseline_detour - chosen["detour_km"]), 3)
    if chosen["strategy"] == "walk":
        why = "Walk {:.0f} m (≈{:.0f} min) to a point already on the route — driver detour 0 km".format(
            chosen["walk_km"] * 1000, chosen["walk_min"])
    else:
        why = "Driver detours only +{:.1f} km (≈{:.0f} min) to reach your door; your walk {:.0f} m".format(
            chosen["detour_km"], chosen["detour_min"], chosen["walk_km"] * 1000)

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