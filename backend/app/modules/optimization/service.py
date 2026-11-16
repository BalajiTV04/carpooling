"""Minimum-detour pickup optimisation service.

Implements the 8-step route-snapping, corridor-matching and detour evaluation algorithm.
Reuses existing app/services/geo_math.py and app/services/routing.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.core.config import get_settings
from app.modules.optimization.geo_utils import (
    bbox_contains,
    cumulative_km,
    haversine_km,
    point_at_km,
    project_onto_route,
    route_length_km,
    sub_polyline,
)
from app.services import detour as detour_facade

_CITY_SPEED_KMPH = 25.0
_TIME_WINDOW_MIN = 120.0


def _minutes(km: float) -> float:
    return round((km / _CITY_SPEED_KMPH) * 60.0, 1)


@dataclass
class DetourConfig:
    pickup_snap_km: float = 0.5
    max_pickup_distance_km: float = 3.0
    dest_tolerance_km: float = 2.0
    max_detour_km: float = 3.0
    max_extra_min: float = 10.0
    fuel_price_per_litre: float = 100.0
    cost_split_policy: str = "EQUAL_SPLIT"
    include_detour_cost: bool = False

    @classmethod
    def from_settings(cls) -> "DetourConfig":
        s = get_settings()
        return cls(
            pickup_snap_km=float(getattr(s, "PICKUP_SNAP_KM", 0.5)),
            max_pickup_distance_km=float(
                getattr(s, "MAX_PICKUP_DISTANCE_KM", 3.0)
            ),
            dest_tolerance_km=float(getattr(s, "DEST_TOLERANCE_KM", 2.0)),
            max_detour_km=float(getattr(s, "MAX_DETOUR_KM", 3.0)),
            max_extra_min=float(getattr(s, "MAX_EXTRA_MIN", 10.0)),
            fuel_price_per_litre=float(
                getattr(s, "FUEL_PRICE_PER_LITRE", 100.0)
            ),
            cost_split_policy=str(getattr(s, "COST_SPLIT_POLICY", "EQUAL_SPLIT")),
            include_detour_cost=bool(getattr(s, "INCLUDE_DETOUR_COST", False)),
        )


@dataclass
class DetourPickup:
    point: List[float]
    cum_km: float
    walk_km: float
    detour_km: float
    on_route: bool
    estimated: bool


@dataclass
class DetourDrop:
    point: List[float]
    cum_km: float
    dest_km: float


@dataclass
class DetourResult:
    feasible: bool
    reason: Optional[str]
    estimated: bool
    pickup: Optional[DetourPickup]
    drop: Optional[DetourDrop]
    detour_km: float
    extra_time_min: float
    passenger_distance_km: float
    walk_distance_km: float
    route_overlap_percent: float
    route_total_km: float
    driver_route_polyline: List[List[float]]
    passenger_segment_polyline: List[List[float]]


def _empty_result(reason: str, estimated: bool = False) -> DetourResult:
    return DetourResult(
        feasible=False,
        reason=reason,
        estimated=estimated,
        pickup=None,
        drop=None,
        detour_km=0.0,
        extra_time_min=0.0,
        passenger_distance_km=0.0,
        walk_distance_km=0.0,
        route_overlap_percent=0.0,
        route_total_km=0.0,
        driver_route_polyline=[],
        passenger_segment_polyline=[],
    )


async def evaluate_detour(
    trip_doc: Dict,
    src: List[float],
    dst: List[float],
    seats_needed: int = 1,
    wanted_dt: Optional[datetime] = None,
    config: Optional[DetourConfig] = None,
) -> DetourResult:
    """Evaluate whether a passenger's ride request is feasible against a driver's route.

    Algorithm steps:
    1. Precompute cumulative distance along driver's route polyline.
    2. Project pickup S onto polyline; evaluate candidates; determine detour.
    3. Project dropoff T onto polyline; check destination tolerance.
    4. Enforce direction rule: drop cum_km > pickup cum_km.
    5. Compute passenger shared distance = drop cum_km - pickup cum_km.
    6. Filter by seats, detour <= max, extra time <= max, pickup <= max, time window.
    7. Multi-candidate evaluation choosing lowest detour, tie-break smallest walk.
    8. Pre-filter API calls; fallback to haversine with estimated=True on API failure.
    """
    cfg = config or DetourConfig.from_settings()

    # Step 6 filter: check seats availability
    seats_offered = int(trip_doc.get("seats_offered", 0) or 0)
    seats_booked = int(trip_doc.get("seats_booked", 0) or 0)
    if seats_offered - seats_booked < seats_needed:
        return _empty_result("no seats available")

    geom = (trip_doc.get("route_geometry") or {}).get("coordinates")
    if not geom or len(geom) < 2:
        return _empty_result("no route geometry")

    # Step 1: Load polyline and compute cumulative distances
    coords: List[List[float]] = [[float(p[0]), float(p[1])] for p in geom]
    cum = cumulative_km(coords)
    total = cum[-1] if cum else 0.0
    if total <= 0:
        return _empty_result("empty route")

    A = coords[0]
    C = coords[-1]
    route_total_km = float(
        trip_doc.get("distance_km") or route_length_km(coords)
    )

    # Step 8: Pre-filter with bounding box before heavier checks
    if not bbox_contains(coords, src, margin_km=cfg.max_pickup_distance_km + 2.0):
        return _empty_result("pickup out of route area")

    # Step 2: Project S onto polyline
    proj_src = project_onto_route(src, coords)
    snap_distance_km = float(proj_src.get("dist_km", float("inf")))
    if snap_distance_km > cfg.max_pickup_distance_km:
        return _empty_result("pickup too far from route")

    p_frac = float(proj_src.get("frac", 0.0) or 0.0)
    p_cum = p_frac * total

    # Step 7: Sample candidate points on polyline within walking radius
    candidates: List[Tuple[float, float]] = [(p_cum, snap_distance_km)]
    step_km = 0.25
    lo = max(0.0, p_cum - cfg.max_pickup_distance_km)
    hi = min(total, p_cum + cfg.max_pickup_distance_km)
    k = lo
    while k <= hi + 1e-9:
        if abs(k - p_cum) > 1e-6:
            pt = point_at_km(coords, k)
            if pt is not None:
                candidates.append((k, haversine_km(src, pt)))
        k += step_km

    scored: List[Tuple[float, float, List[float], float, bool]] = []
    for cand_cum, walk_km in candidates:
        pt = point_at_km(coords, cand_cum)
        if pt is None:
            continue
        if walk_km <= cfg.pickup_snap_km:
            scored.append((0.0, walk_km, pt, cand_cum, True))
        elif walk_km <= cfg.max_pickup_distance_km:
            scored.append((walk_km, walk_km, pt, cand_cum, False))

    if not scored:
        return _empty_result("no viable pickup candidate")

    # Tie-break by smallest walking distance
    scored.sort(key=lambda x: (x[0], x[1]))
    best_detour, best_walk, best_pt, best_cum, best_on_route = scored[0]

    pickup_estimated = False
    pickup_detour = best_detour
    if not best_on_route:
        # Step 2 & 8: off route -> call routing service for actual detour
        # If OSRM fails, fallback to haversine estimate with estimated=True
        routed = await detour_facade.osrm_route(best_pt, src)
        if routed is not None:
            pickup_detour = float(routed.get("distance_km", best_detour))
        else:
            pickup_detour = best_detour
            pickup_estimated = True

    pickup = DetourPickup(
        point=best_pt,
        cum_km=best_cum,
        walk_km=round(best_walk, 3),
        detour_km=round(pickup_detour, 3),
        on_route=best_on_route,
        estimated=pickup_estimated,
    )

    # Step 3: Project T onto polyline to get Q
    proj_dst = project_onto_route(dst, coords)
    q_frac = float(proj_dst.get("frac", 0.0) or 0.0)
    q_cum = q_frac * total
    Q = point_at_km(coords, q_cum) or list(C)
    dest_km = haversine_km(dst, Q)
    to_driver_dest = haversine_km(dst, C)

    # Step 4: Direction rule: drop cum_km must be > pickup cum_km
    if q_cum <= pickup.cum_km + 1e-6:
        return _empty_result(
            "wrong direction / drop before pickup", estimated=pickup_estimated
        )

    # Step 3 check: Q is driver's destination OR T is within tolerance
    drop_ok = (
        to_driver_dest <= cfg.dest_tolerance_km
        or haversine_km(Q, C) <= cfg.dest_tolerance_km
    )
    if not drop_ok:
        return _empty_result(
            "destination not on/near route", estimated=pickup_estimated
        )

    drop = DetourDrop(
        point=Q,
        cum_km=q_cum,
        dest_km=round(dest_km, 3),
    )

    # Step 5: Passenger distance = cumulative(Q) - cumulative(P)
    passenger_distance_km = round(q_cum - pickup.cum_km, 3)
    if passenger_distance_km <= 0:
        return _empty_result("no shared distance", estimated=pickup_estimated)

    detour_km = round(pickup.detour_km, 3)
    extra_time_min = _minutes(detour_km)

    # Step 6: Feasibility limits check
    if detour_km > cfg.max_detour_km:
        return _empty_result(
            f"detour {detour_km} km > {cfg.max_detour_km} km max",
            estimated=pickup_estimated,
        )
    if extra_time_min > cfg.max_extra_min:
        return _empty_result(
            f"extra {extra_time_min} min > {cfg.max_extra_min} min max",
            estimated=pickup_estimated,
        )
    if snap_distance_km > cfg.max_pickup_distance_km:
        return _empty_result("pickup snap too far", estimated=pickup_estimated)

    # Step 6: Date and time window filter
    if wanted_dt is not None:
        depart_at = trip_doc.get("depart_at")
        if depart_at is None:
            return _empty_result("no departure time", estimated=pickup_estimated)
        if depart_at.tzinfo is None:
            depart_at = depart_at.replace(tzinfo=timezone.utc)
        if depart_at.date() != wanted_dt.date():
            return _empty_result("wrong date", estimated=pickup_estimated)
        tdiff = abs((depart_at - wanted_dt).total_seconds()) / 60.0
        if tdiff > _TIME_WINDOW_MIN:
            return _empty_result("outside time window", estimated=pickup_estimated)

    route_overlap_percent = round(
        (passenger_distance_km / route_total_km) * 100.0, 1
    ) if route_total_km > 0 else 0.0

    segment_polyline = sub_polyline(coords, cum, pickup.cum_km, drop.cum_km)

    return DetourResult(
        feasible=True,
        reason=None,
        estimated=pickup_estimated,
        pickup=pickup,
        drop=drop,
        detour_km=detour_km,
        extra_time_min=extra_time_min,
        passenger_distance_km=passenger_distance_km,
        walk_distance_km=round(pickup.walk_km, 3),
        route_overlap_percent=route_overlap_percent,
        route_total_km=round(route_total_km, 2),
        driver_route_polyline=coords,
        passenger_segment_polyline=segment_polyline,
    )
