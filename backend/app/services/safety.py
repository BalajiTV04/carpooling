"""Safety verdicts (Module 18): pure, no DB, no network.

Two auto-detectors run on every tracking ping (same `locations` stream as
Module 17 — no new storage, no new dependency):

- speed: reported speed_kmph > SPEED_LIMIT_KMPH (80) -> over-speed alert.
  Severity escalates with margin: +0-20 medium, +20-40 high, +40 critical.
- deviation: off-route distance > OFF_ROUTE_M (500, shared with tracking) ->
  route-deviation alert, severity high (a lost/confused driver matters fast).

Thresholds live here so the tracking hook, the API, and the tests share one
definition. Dedupe policy: at most one OPEN alert per (trip, type) — the hook
skips creation while one is open, so a 10s ping cadence cannot spam.
"""
from typing import Dict, Optional

from app.services.tracking import OFF_ROUTE_M

SPEED_LIMIT_KMPH = 80.0


def speed_verdict(speed_kmph: Optional[float],
                  limit: float = SPEED_LIMIT_KMPH) -> Dict:
    """{over, severity|None, margin} — None speed is never a violation."""
    if speed_kmph is None:
        return {"over": False, "severity": None, "margin": 0.0}
    try:
        v = float(speed_kmph)
    except (TypeError, ValueError):
        return {"over": False, "severity": None, "margin": 0.0}
    margin = v - limit
    if margin <= 0:
        return {"over": False, "severity": None, "margin": round(margin, 1)}
    if margin > 40:
        sev = "critical"
    elif margin > 20:
        sev = "high"
    else:
        sev = "medium"
    return {"over": True, "severity": sev, "margin": round(margin, 1)}


def deviation_verdict(off_route_m: Optional[float]) -> Dict:
    """{deviated, severity|None} — None (unrouted trip) never deviates."""
    if off_route_m is None:
        return {"deviated": False, "severity": None}
    try:
        m = float(off_route_m)
    except (TypeError, ValueError):
        return {"deviated": False, "severity": None}
    if m <= OFF_ROUTE_M:
        return {"deviated": False, "severity": None}
    return {"deviated": True, "severity": "high"}
