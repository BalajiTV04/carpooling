"""Routing service (Module 7): OSRM route + Nominatim geocode, free OSM stack.

Why OSRM public demo + Nominatim (proposal → locked):
- OSRM demo (router.project-osrm.org): free, no key, driving profile, returns
  GeoJSON geometry + distance + duration. Rate-limited (~1 req/s courtesy) —
  fine for an MCA project; self-host switch = one env var (OSRM_URL).
- Nominatim: free, no key, OSM search + reverse. Requires a real User-Agent
  (set below) and <=1 req/s — we cache + debounce.
- Rejected: Google/Mapbox (billing), Valhalla/GraphHopper self-host (ops
  burden for a college timeline). Self-host OSRM later = change OSRM_URL only.

Resilience: every call has timeout + haversine fallback. A trip NEVER fails
to save because routing is down — it saves with crow-flies distance and
route_geometry=None, and /route/refresh retries later. This is the correct
trade-off: routing is enrichment, not a hard gate.
"""
import time
from typing import Dict, List, Optional, Tuple

import httpx

from app.core.config import get_settings

# Nominatim REQUIRES a real identifying User-Agent and will return 403
# ("Access denied") for generic or placeholder ones. The previous value ended in
# the placeholder domain `example.com`, which OSM blocks outright, so every
# geocode silently degraded to the empty-list fallback and the place picker
# could never find anything. Keep this a real, contactable identifier and
# override it per-deployment with NOMINATIM_USER_AGENT.
_DEFAULT_UA = "VoltRide/1.0 (https://github.com/BalajiTV04/OnlineCourseRegistration)"


def _user_agent() -> str:
    return (get_settings().NOMINATIM_USER_AGENT or _DEFAULT_UA).strip()

# Tiny in-process caches: OSRM demo is rate-limited, so repeat route lookups
# (same trip viewed 10×) must not hammer it. Key = rounded coord pair.
_route_cache: Dict[str, dict] = {}
_geocode_cache: Dict[str, list] = {}
_CACHE_TTL = 3600  # seconds
_cache_ts: Dict[str, float] = {}


def _cache_get(store: Dict, key: str):
    if key in store and (time.time() - _cache_ts.get(key, 0)) < _CACHE_TTL:
        return store[key]
    store.pop(key, None)
    _cache_ts.pop(key, None)
    return None


def _cache_set(store: Dict, key: str, value) -> None:
    store[key] = value
    _cache_ts[key] = time.time()


def _round6(coords: List[float]) -> str:
    return "{:.6f},{:.6f}".format(coords[0], coords[1])


async def osrm_route(src: List[float], dst: List[float]) -> Optional[Dict]:
    """OSRM driving route. Returns {geometry, distance_km, duration_min} or None.

    src/dst = [lng, lat]. Geometry = GeoJSON LineString (full resolution —
    stored on trips for Module 9 matching; simplified client-side for maps).
    """
    settings = get_settings()
    key = "r:" + _round6(src) + ">" + _round6(dst)
    hit = _cache_get(_route_cache, key)
    if hit is not None:
        return hit
    url = "{}/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson".format(
        settings.OSRM_URL.rstrip("/"), src[0], src[1], dst[0], dst[1])
    try:
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": _user_agent()}) as client:
            res = await client.get(url)
        if res.status_code != 200:
            return None
        body = res.json()
        routes = body.get("routes") or []
        if not routes:
            return None
        best = routes[0]
        out = {
            "geometry": best.get("geometry"),  # GeoJSON LineString
            "distance_km": round(float(best.get("distance", 0)) / 1000.0, 2),
            "duration_min": round(float(best.get("duration", 0)) / 60.0, 1),
        }
        if not out["geometry"]:
            return None
        _cache_set(_route_cache, key, out)
        return out
    except Exception:
        return None


async def nominatim_search(query: str, limit: int = 5,
                           viewbox: Optional[Tuple[float, float, float, float]] = None,
                           bounded: bool = False) -> List[Dict]:
    """Forward geocode. Returns [{name, address, lat, lng}]. Empty on failure.

    `viewbox` is a RANKING BIAS by default, not a hard fence. With bounded=True
    Nominatim drops anything outside the box - which used to exclude Mandya,
    Mysuru and the rest of Karnataka from a Bengaluru-sized box. Biased-only
    keeps Bengaluru ranked first while still letting the whole state through;
    the frontend fuzzy catalogue (lib/placeCatalog.ts) handles typos anyway.
    """
    q = query.strip()
    if len(q) < 3:
        return []
    key = "g:" + q.lower() + ":" + str(limit) + ":" + ("b" if bounded else "u")
    hit = _cache_get(_geocode_cache, key)
    if hit is not None:
        return hit
    settings = get_settings()
    params = {"q": q, "format": "json", "limit": limit, "addressdetails": 1}
    if viewbox:
        params["viewbox"] = ",".join(map(str, viewbox))
        params["bounded"] = 1 if bounded else 0
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": _user_agent()}) as client:
            res = await client.get(settings.NOMINATIM_URL.rstrip("/") + "/search", params=params)
        if res.status_code != 200:
            return []
        out = [{"name": (r.get("display_name") or "").split(",")[0],
                "address": r.get("display_name"),
                "lat": float(r["lat"]), "lng": float(r["lon"])}
               for r in res.json() if "lat" in r and "lon" in r]
        _cache_set(_geocode_cache, key, out)
        return out
    except Exception:
        return []


async def nominatim_reverse(lat: float, lng: float) -> Optional[Dict]:
    """Reverse geocode (map click → place name)."""
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": _user_agent()}) as client:
            res = await client.get(
                settings.NOMINATIM_URL.rstrip("/") + "/reverse",
                params={"lat": lat, "lon": lng, "format": "json"})
        if res.status_code != 200:
            return None
        body = res.json()
        name = body.get("display_name", "").split(",")[0] or "Pinned point"
        return {"name": name, "address": body.get("display_name"),
                "lat": lat, "lng": lng}
    except Exception:
        return None

