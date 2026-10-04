"""Shared geo math (Modules 9-10): projection, distances, polyline walking.

Why equirectangular? At city scale (≤100 km) it is accurate to ~0.5% and needs
no proj4/GDAL dependency — perfect for an MCA project and fast enough to run
hundreds of candidate evaluations per request. All coordinates are [lng, lat].
"""
from math import asin, cos, radians, sin, sqrt
from typing import Dict, List, Optional, Tuple


def haversine_km(a: List[float], b: List[float]) -> float:
    """Great-circle distance in km between two [lng, lat] points."""
    lon1, lat1, lon2, lat2 = map(radians, [a[0], a[1], b[0], b[1]])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(h))


def xy(lng: float, lat: float, lat0: float) -> Tuple[float, float]:
    """Equirectangular projection to km around reference latitude lat0."""
    return (lng * 111.32 * cos(radians(lat0)), lat * 110.57)


def seg_proj(px: float, py: float, ax: float, ay: float,
             bx: float, by: float) -> Tuple[float, float]:
    """Distance from P to segment AB (km) + t in [0,1] along AB."""
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom == 0:
        t = 0.0
    else:
        t = ((px - ax) * dx + (py - ay) * dy) / denom
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    cx, cy = ax + t * dx, ay + t * dy
    return (((px - cx) ** 2 + (py - cy) ** 2) ** 0.5, t)


def cumulative_km(coords: List[List[float]]) -> List[float]:
    """Distance along the polyline at each vertex, in km (starts at 0)."""
    if not coords:
        return []
    lat0 = sum(c[1] for c in coords) / len(coords)
    out = [0.0]
    total = 0.0
    for i in range(len(coords) - 1):
        ax, ay = xy(coords[i][0], coords[i][1], lat0)
        bx, by = xy(coords[i + 1][0], coords[i + 1][1], lat0)
        total += ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        out.append(total)
    return out


def route_length_km(coords: List[List[float]]) -> float:
    cum = cumulative_km(coords)
    return cum[-1] if cum else 0.0


def project_onto_route(pt: List[float], coords: List[List[float]]) -> Dict:
    """Nearest polyline point -> {dist_km, frac}. frac = route progress 0..1."""
    lat0 = pt[1]
    px, py = xy(pt[0], pt[1], lat0)
    total = 0.0
    segs = []
    for i in range(len(coords) - 1):
        ax, ay = xy(coords[i][0], coords[i][1], lat0)
        bx, by = xy(coords[i + 1][0], coords[i + 1][1], lat0)
        length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        segs.append((length, ax, ay, bx, by))
        total += length
    if total <= 0:
        return {"dist_km": float("inf"), "frac": 0.0}
    best_d, best_frac, cum = float("inf"), 0.0, 0.0
    for (length, ax, ay, bx, by) in segs:
        d, t = seg_proj(px, py, ax, ay, bx, by)
        if d < best_d:
            best_d = d
            best_frac = (cum + t * length) / total
        cum += length
    return {"dist_km": best_d, "frac": best_frac}


def point_at_km(coords: List[List[float]], km: float) -> Optional[List[float]]:
    """Interpolated [lng, lat] at distance km along the polyline (clamped)."""
    if not coords:
        return None
    if len(coords) == 1:
        return list(coords[0])
    cum = cumulative_km(coords)
    total = cum[-1]
    if total <= 0:
        return list(coords[0])
    km = max(0.0, min(km, total))
    # find segment containing km
    for i in range(len(cum) - 1):
        if cum[i] <= km <= cum[i + 1]:
            span = cum[i + 1] - cum[i]
            t = 0.0 if span == 0 else (km - cum[i]) / span
            a, b = coords[i], coords[i + 1]
            return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    return list(coords[-1])


def simplify(coords: List[List[float]], max_points: int = 200) -> List[List[float]]:
    """Uniform down-sampling for map rendering (keeps first + last point)."""
    if len(coords) <= max_points or max_points < 2:
        return coords
    step = (len(coords) - 1) / float(max_points - 1)
    out = [coords[int(round(i * step))] for i in range(max_points)]
    out[0], out[-1] = coords[0], coords[-1]
    return out
