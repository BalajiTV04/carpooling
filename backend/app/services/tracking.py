"""Tracking progress math (Module 17): pure, no DB, no network.

progress_frac() projects a live GPS point onto the trip route polyline and
returns {frac, dist_along_km, off_route_m, remaining_km} on the SAME
equirectangular ruler as Modules 9/10/13 — one consistent ruler project-wide.
speed_kmph() converts consecutive fixes into a speed estimate for ETAs.

Thresholds live here so the API, safety (M18), and tests share one definition:
OFF_ROUTE_M = 500 (beyond = off-route), STALE_S = 300 (no fix in 5 min = stale).
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.services.geo_math import haversine_km, project_onto_route, route_length_km

OFF_ROUTE_M = 500.0
STALE_S = 300.0


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def progress_frac(coords: List[List[float]], lng: float, lat: float) -> Dict:
    """Project [lng, lat] onto route -> progress + off-route distance."""
    total = route_length_km(coords)
    proj = project_onto_route([lng, lat], coords)
    frac = max(0.0, min(1.0, proj["frac"]))
    along = round(frac * total, 3)
    return {
        "frac": round(frac, 4),
        "dist_along_km": along,
        "remaining_km": round(max(0.0, total - along), 3),
        "off_route_m": round(proj["dist_km"] * 1000.0, 0),
        "off_route": proj["dist_km"] * 1000.0 > OFF_ROUTE_M,
        "route_km": round(total, 3),
    }


def speed_kmph(prev: Optional[Dict], lng: float, lat: float,
               at: Optional[datetime] = None) -> Optional[float]:
    """km/h between the previous fix and this one; None when unknowable."""
    if not prev:
        return None
    try:
        plat, plng = float(prev["lat"]), float(prev["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    at = _aware(at or datetime.now(timezone.utc))
    pat = prev.get("at")
    if not isinstance(pat, datetime):
        return None
    dt_s = (at - _aware(pat)).total_seconds()
    if dt_s <= 0:
        return None
    km = haversine_km([plng, plat], [lng, lat])
    v = km / dt_s * 3600.0
    if v < 0 or v > 300:
        return None
    return round(v, 1)


def is_stale(last_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    if last_at is None:
        return True
    now = _aware(now or datetime.now(timezone.utc))
    return (now - _aware(last_at)).total_seconds() > STALE_S
