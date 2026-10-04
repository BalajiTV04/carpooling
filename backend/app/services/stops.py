"""Stop extraction shared by the segment endpoints + rebuild hook."""

from typing import Dict, List

from app.services.geo_math import project_onto_route


def stops_from_bookings(trip: Dict, bookings: List[Dict]) -> List[Dict]:
    """Confirmed/accepted bookings -> riders [{id, seats, board_frac,
    alight_frac, board_label, alight_label}] via route projection.

    Board/alight come from the BOOKING's stored pickup/dropoff (the Module 10
    snapshot), not the request — what was agreed is what is priced.

    Trips WITHOUT geometry cannot project: riders get fractions derived from
    endpoint order (board 0, alight 1 = full ride each). Callers use this to
    decide whether per-leg splits are meaningful at all.
    """
    geom = (trip.get("route_geometry") or {}).get("coordinates") or []
    riders = []
    for b in bookings:
        try:
            p = b["pickup"]["point"]["coordinates"]
            d = b["dropoff"]["point"]["coordinates"]
        except (KeyError, TypeError):
            continue
        if geom and len(geom) >= 2:
            board_frac = round(project_onto_route(p, geom)["frac"], 4)
            alight_frac = round(project_onto_route(d, geom)["frac"], 4)
        else:
            board_frac, alight_frac = 0.0, 1.0
        if alight_frac - board_frac <= 0:
            continue  # backwards rider: priced by Module 12 fallback, not here
        riders.append({
            "id": str(b["_id"]),
            "seats": int(b.get("seats", 1)),
            "board_frac": board_frac,
            "alight_frac": alight_frac,
            "board_label": (b.get("pickup") or {}).get("name") or "Pickup",
            "alight_label": (b.get("dropoff") or {}).get("name") or "Drop-off",
        })
    return riders