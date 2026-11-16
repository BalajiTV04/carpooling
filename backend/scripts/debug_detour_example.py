"""Diagnostic script for Minimum-Detour Pickup Optimization (Phase 1).

Fetches real OSRM geometry for Devanahalli->Hebbal (driver) and Yelahanka->Hebbal
(passenger), runs the current matching logic used by /search/rides, prints diagnostic
metrics, and saves the recorded route geometries to backend/tests/fixtures/.
"""
from __future__ import print_function
import asyncio
import json
import os
import sys
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.services.routing import nominatim_search, osrm_route
from app.services.matching import match_trip
from app.services.geo_math import (
    haversine_km,
    project_onto_route,
    route_length_km,
    cumulative_km,
)
from app.api.v1.trips import _haversine_km

# Fallback sample coordinates (debug script and tests only, never in app code)
# Devanahalli: 13.2437, 77.7120; Yelahanka: 13.1007, 77.5963; Hebbal: 13.0358, 77.5970
# Coordinates are [lng, lat]
FALLBACK_COORDS = {
    "Devanahalli": [77.7120, 13.2437],
    "Yelahanka": [77.5963, 13.1007],
    "Hebbal": [77.5970, 13.0358],
}


async def resolve_place(name):
    """Resolve coordinates using geocoder/catalogue with fallback."""
    try:
        hits = await nominatim_search(name, limit=1)
        if hits and "lng" in hits[0] and "lat" in hits[0]:
            return [hits[0]["lng"], hits[0]["lat"]], "nominatim"
    except Exception as e:
        pass
    return FALLBACK_COORDS[name], "sample_fallback"


async def main():
    print("=" * 70)
    print("VOLTRIDE DETOUR OPTIMIZATION DIAGNOSTIC SCRIPT (PHASE 1)")
    print("=" * 70)

    # 1. Geocode places
    dev_coords, dev_src = await resolve_place("Devanahalli")
    yel_coords, yel_src = await resolve_place("Yelahanka")
    heb_coords, heb_src = await resolve_place("Hebbal")

    print(f"Places resolved:")
    print(f"  Devanahalli (Driver Origin): {dev_coords} (source: {dev_src})")
    print(f"  Hebbal (Driver/Pax Dest):    {heb_coords} (source: {heb_src})")
    print(f"  Yelahanka (Passenger Origin):{yel_coords} (source: {yel_src})")
    print()

    # 2. Get OSRM routes
    driver_route = await osrm_route(dev_coords, heb_coords)
    pax_route = await osrm_route(yel_coords, heb_coords)

    # 3. Save fixtures
    fixtures_dir = backend_dir / "tests" / "fixtures"
    fixtures_dir.mkdir(parents=True, exist_ok=True)

    if driver_route:
        with open(fixtures_dir / "devanahalli_hebbal.json", "w") as f:
            json.dump(driver_route, f, indent=2)
        print(f"Saved fixture: {fixtures_dir / 'devanahalli_hebbal.json'}")

    if pax_route:
        with open(fixtures_dir / "yelahanka_hebbal.json", "w") as f:
            json.dump(pax_route, f, indent=2)
        print(f"Saved fixture: {fixtures_dir / 'yelahanka_hebbal.json'}")
    print()

    # 4. Analyze Driver Route Geometry
    if driver_route:
        route_quality = "routed"
        coords = driver_route["geometry"]["coordinates"]
        driver_distance_km = driver_route["distance_km"]
        driver_duration_min = driver_route.get("duration_min")
    else:
        route_quality = "straight_line"
        coords = [dev_coords, heb_coords]
        driver_distance_km = round(haversine_km(dev_coords, heb_coords), 2)
        driver_duration_min = None

    print("-" * 70)
    print(f"DRIVER ROUTE (Devanahalli -> Hebbal):")
    print(f"  Route Quality:        {route_quality}")
    print(f"  Driver Distance:      {driver_distance_km} km")
    print(f"  Driver Duration:      {driver_duration_min} min")
    print(f"  Vertex Count:         {len(coords)}")
    print("-" * 70)

    # 5. Projections & Geometry Analysis
    proj_p = project_onto_route(yel_coords, coords)
    proj_d = project_onto_route(heb_coords, coords)

    total_len = route_length_km(coords)
    p_along_km = round(proj_p["frac"] * total_len, 3)
    p_offset_km = round(proj_p["dist_km"], 3)
    d_along_km = round(proj_d["frac"] * total_len, 3)
    d_offset_km = round(proj_d["dist_km"], 3)

    print(f"PROJECTION DIAGNOSTICS:")
    print(f"  Pickup (Yelahanka):")
    print(f"    along_km:           {p_along_km} km (fraction: {proj_p['frac']:.4f})")
    print(f"    offset_km:          {p_offset_km} km (distance from route)")
    print(f"  Drop (Hebbal):")
    print(f"    along_km:           {d_along_km} km (fraction: {proj_d['frac']:.4f})")
    print(f"    offset_km:          {d_offset_km} km (distance from route)")
    print()

    # Shared distance along driver route
    shared_km = max(0.0, d_along_km - p_along_km)
    forward = d_along_km > p_along_km + 1e-6
    print(f"  Forward Direction:    {forward}")
    print(f"  Shared Distance:      {shared_km:.3f} km")
    print()

    # 6. Current matching.py logic
    m_result = match_trip(coords, yel_coords, heb_coords)
    print("-" * 70)
    print("CURRENT matching.py (match_trip) RESULT:")
    for k, v in m_result.items():
        print(f"  {k}: {v}")
    print()
    print("  Overlap Analysis in current code:")
    print(f"    Current overlap_pct:   {m_result.get('overlap_pct')}%")
    print(f"    Current denominator:   Driver's total route length ({total_len:.2f} km)")
    print(f"    Fraction of driver:    {shared_km:.2f} / {total_len:.2f} = {(shared_km / total_len * 100):.1f}%")
    pax_direct_km = haversine_km(yel_coords, heb_coords)
    pax_journey_km = pax_route["distance_km"] if pax_route else pax_direct_km
    print(f"    Passenger journey:     {pax_journey_km:.2f} km")
    print(f"    True passenger share:  {shared_km:.2f} / {pax_journey_km:.2f} = {(shared_km / pax_journey_km * 100):.1f}%")
    print("-" * 70)

    # 7. Check /search/rides retrieval pre-filter (search.py lines 74-77)
    print("CHECKING /api/v1/search/rides RETRIEVAL PRE-FILTER:")
    src_km = _haversine_km(yel_coords, dev_coords)
    dst_km = _haversine_km(heb_coords, heb_coords)
    default_radius_km = 8.0
    print(f"  Passenger requested pickup: Yelahanka {yel_coords}")
    print(f"  Driver trip origin:        Devanahalli {dev_coords}")
    print(f"  _haversine_km(yel, dev):   {src_km:.2f} km")
    print(f"  Search radius_km limit:    {default_radius_km} km")
    if src_km > default_radius_km:
        print(f"  CRITICAL BUG REPRODUCED: src_km ({src_km:.2f} km) > radius_km ({default_radius_km} km)")
        print(f"  Trip is SILENTLY DROPPED by search.py before match_trip is ever called!")
        print(f"  Trip NEVER appears in results OR excluded list!")
    else:
        print(f"  Passes pre-filter.")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
