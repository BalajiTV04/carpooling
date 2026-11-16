"""Geometry utilities for route projection, slicing, and distance calculations.

Reuses core math from app.services.geo_math without duplicating formulas.
"""
from typing import List, Optional, Tuple

from app.services.geo_math import (
    cumulative_km,
    haversine_km,
    point_at_km,
    project_onto_route,
    route_length_km,
)

__all__ = [
    "cumulative_km",
    "haversine_km",
    "point_at_km",
    "project_onto_route",
    "route_length_km",
    "sub_polyline",
    "bbox_contains",
]


def bbox_contains(coords: List[List[float]], pt: List[float], margin_km: float = 5.0) -> bool:
    """Pre-filter bounding box check to limit unnecessary routing API calls."""
    if not coords:
        return False
    # ~1 deg lat is ~111 km, ~1 deg lng at 13N is ~108 km
    deg_margin = margin_km / 100.0
    lngs = [p[0] for p in coords]
    lats = [p[1] for p in coords]
    min_lng, max_lng = min(lngs) - deg_margin, max(lngs) + deg_margin
    min_lat, max_lat = min(lats) - deg_margin, max(lats) + deg_margin
    return min_lng <= pt[0] <= max_lng and min_lat <= pt[1] <= max_lat


def sub_polyline(
    coords: List[List[float]],
    cum: List[float],
    start_km: float,
    end_km: float,
) -> List[List[float]]:
    """Extract route vertices strictly between start_km and end_km (clamped)."""
    if not coords or len(coords) < 2:
        return []
    total = cum[-1] if cum else 0.0
    start_km = max(0.0, min(start_km, total))
    end_km = max(0.0, min(end_km, total))
    if end_km <= start_km:
        return [point_at_km(coords, start_km) or coords[0]]
    out: List[List[float]] = [point_at_km(coords, start_km) or coords[0]]
    for i in range(len(cum) - 1):
        a, b = cum[i], cum[i + 1]
        if b < start_km or a > end_km:
            continue
        out.append(list(coords[i + 1]))
    out.append(point_at_km(coords, end_km) or coords[-1])
    cleaned: List[List[float]] = []
    for p in out:
        if not cleaned or haversine_km(p, cleaned[-1]) > 0.0005:
            cleaned.append(p)
    return cleaned
