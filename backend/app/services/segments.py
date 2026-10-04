"""Segment builder (Module 13): pure geometry + money math, no DB, no network.

PIPELINE
1. Stops = trip source (frac 0) + each rider's board/alight fracs + dest (1),
   sorted; zero-length gaps dropped.
2. Segment distance = frac-gap × route_km (same equirectangular basis as
   Modules 9/10 — one consistent ruler across the project).
3. A rider occupies a segment iff board_frac ≤ seg_start AND alight_frac ≥
   seg_end (epsilon-tolerant), i.e. they ride the WHOLE leg.
4. Each leg is priced (leg_km × price_per_km, fuel-only) and split ONLY among
   its occupants, under the trip's Module 12 policy mode:
     split_equal  → leg_cost / (1 + n_occupants) per seat (driver takes a
                     slice too, uncollected — same contract as Module 12)
     per_seat     → leg_cost × rider_seats / seats_offered
     split_riders → leg_cost × rider_seats / seats_on_this_leg
5. Booking total = Σ occupied legs; capped at the trip total so the driver
   can never profit; rounding residue lands on the last confirmed booking.

Riders are dicts: {id, seats, board_frac, alight_frac, board_label,
alight_label}. All fracs in [0, 1] with board < alight (validated upstream).
"""
from typing import Dict, List, Optional

from app.services.geo_math import point_at_km, route_length_km

EPS_FRAC = 1e-3  # tolerance for frac comparisons (fracs are rounded to 4dp)


def build_segments(route_coords: List[List[float]],
                   source_label: str,
                   dest_label: str,
                   riders: List[Dict],
                   seats_offered: int,
                   mode: str,
                   price_per_km: float) -> Dict:
    """Returns {segments, totals, route_km, collected_total, trip_total_cap}."""
    route_km = round(route_length_km(route_coords), 3)
    trip_cap = round(price_per_km * route_km, 2)

    # --- collect unique stop fracs with labels --------------------------------
    valid: List[Dict] = []
    for r in riders:
        b, a = float(r["board_frac"]), float(r["alight_frac"])
        if not (0.0 - EPS_FRAC <= b < a <= 1.0 + EPS_FRAC):
            continue  # backwards/malformed rider: skipped here, priced by the
            # Module 12 whole-trip fallback upstream (never crashes the split)
        valid.append(dict(r, board_frac=max(0.0, min(1.0, b)),
                          alight_frac=max(0.0, min(1.0, a))))
    stops: Dict[float, str] = {0.0: source_label, 1.0: dest_label}
    for r in valid:
        stops.setdefault(round(float(r["board_frac"]), 4),
                         r.get("board_label") or "Pickup")
        stops.setdefault(round(float(r["alight_frac"]), 4),
                         r.get("alight_label") or "Drop-off")
    fracs = sorted(stops)

    # --- legs ------------------------------------------------------------------
    segments: List[Dict] = []
    totals: Dict[str, float] = {str(r["id"]): 0.0 for r in valid}
    seq = 0
    for i in range(len(fracs) - 1):
        lo, hi = fracs[i], fracs[i + 1]
        if hi - lo < 1e-6:
            continue
        leg_km = round((hi - lo) * route_km, 3)
        if leg_km <= 0:
            continue
        leg_cost = round(leg_km * price_per_km, 2)
        occupants = [r for r in valid
                     if float(r["board_frac"]) <= lo + EPS_FRAC
                     and float(r["alight_frac"]) >= hi - EPS_FRAC]
        occ_seats = sum(int(r.get("seats", 1)) for r in occupants)
        n = len(occupants)
        shares: Dict[str, float] = {}
        if n > 0 and leg_cost > 0:
            for r in occupants:
                seats = int(r.get("seats", 1))
                if mode == "per_seat":
                    share = leg_cost * seats / seats_offered if seats_offered > 0 else 0.0
                elif mode == "split_riders":
                    share = leg_cost * seats / occ_seats if occ_seats > 0 else 0.0
                else:  # split_equal default
                    share = leg_cost / (1 + n)
                share = round(share, 2)
                shares[str(r["id"])] = share
                totals[str(r["id"])] = round(totals[str(r["id"])] + share, 2)
        per_occ = round(sum(shares.values()) / n, 2) if n else 0.0
        p_lo = point_at_km(route_coords, lo * route_km)
        p_hi = point_at_km(route_coords, hi * route_km)
        segments.append({
            "seq": seq,
            "from_label": stops[lo],
            "to_label": stops[hi],
            "from_frac": lo,
            "to_frac": hi,
            "from_point": {"type": "Point",
                           "coordinates": [round(p_lo[0], 6), round(p_lo[1], 6)]} if p_lo else None,
            "to_point": {"type": "Point",
                         "coordinates": [round(p_hi[0], 6), round(p_hi[1], 6)]} if p_hi else None,
            "distance_km": leg_km,
            "leg_cost": leg_cost,
            "occupant_ids": [str(r["id"]) for r in occupants],
            "shares": shares,
            "cost_per_occupant": per_occ,
        })
        seq += 1

    # --- cap + residue (same doctrine as Module 12) -----------------------------
    for bid in totals:
        totals[bid] = round(min(totals[bid], trip_cap), 2)
    if mode in ("per_seat", "split_riders") and totals:
        target = round(min(trip_cap, sum(totals.values())), 2)
        drift = round(target - sum(totals.values()), 2)
        if abs(drift) >= 0.01:
            last = list(totals)[-1]
            totals[last] = round(totals[last] + drift, 2)

    return {
        "segments": segments,
        "totals": totals,
        "route_km": route_km,
        "price_per_km": round(price_per_km, 4),
        "trip_total_cap": trip_cap,
        "collected_total": round(sum(totals.values()), 2),
    }