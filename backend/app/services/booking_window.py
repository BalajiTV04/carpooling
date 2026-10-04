"""Advance-booking window (Module 14): how far ahead, how close to departure.

WHY: a driver who leaves at 7:00 does not want a request at 6:55, and a trip
posted for next March is usually a mistake. The window turns both into rules
instead of arguments:

    opens_at  = depart_at - max_days_advance
    closes_at = depart_at - min_notice_min

Pure functions here (no DB, no clock injection needed) so the API, search and
tests share one definition of "bookable". Defaults come from Settings.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from app.core.config import get_settings

DEFAULT_MAX_DAYS = 30
DEFAULT_MIN_NOTICE_MIN = 60
MIN_NOTICE_FLOOR_MIN = 0        # 0 = allow last-second bookings
MAX_DAYS_CEIL = 180             # six months is the sane ceiling


def normalise_policy(raw: Optional[Dict]) -> Dict:
    """Coerce stored/partial policy into the canonical shape with defaults."""
    settings = get_settings()
    raw = raw or {}
    max_days = raw.get("max_days_advance")
    min_notice = raw.get("min_notice_min")
    try:
        max_days = int(max_days)
    except (TypeError, ValueError):
        max_days = getattr(settings, "ADVANCE_MAX_DAYS", DEFAULT_MAX_DAYS)
    try:
        min_notice = int(min_notice)
    except (TypeError, ValueError):
        min_notice = getattr(settings, "ADVANCE_MIN_NOTICE_MIN", DEFAULT_MIN_NOTICE_MIN)
    max_days = max(1, min(MAX_DAYS_CEIL, max_days))
    min_notice = max(MIN_NOTICE_FLOOR_MIN, min(24 * 60, min_notice))
    return {"max_days_advance": max_days, "min_notice_min": min_notice}


def window(depart_at: datetime, policy: Optional[Dict],
           now: Optional[datetime] = None) -> Dict:
    """Return {opens_at, closes_at, policy} for a departure time."""
    pol = normalise_policy(policy)
    if depart_at.tzinfo is None:
        depart_at = depart_at.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return {
        "policy": pol,
        "depart_at": depart_at,
        "opens_at": depart_at - timedelta(days=pol["max_days_advance"]),
        "closes_at": depart_at - timedelta(minutes=pol["min_notice_min"]),
    }


def check_window(depart_at: datetime, policy: Optional[Dict],
                 now: Optional[datetime] = None) -> Dict:
    """Can a booking be created right now?

    Returns {bookable, reason, minutes_to_close, days_to_departure, window}.
    Reasons are user-facing strings: they end up in the ride card tooltip.
    """
    w = window(depart_at, policy, now)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    depart = w["depart_at"]
    if depart <= now:
        return {"bookable": False, "reason": "trip has already departed",
                "minutes_to_close": 0, "days_to_departure": 0.0, "window": _iso(w)}
    if now < w["opens_at"]:
        open_in = (w["opens_at"] - now).total_seconds() / 86400.0
        return {"bookable": False,
                "reason": "booking opens {:.1f} days from now (max {} days ahead)".format(
                    open_in, w["policy"]["max_days_advance"]),
                "minutes_to_close": (w["closes_at"] - now).total_seconds() / 60.0,
                "days_to_departure": (depart - now).total_seconds() / 86400.0,
                "window": _iso(w)}
    if now >= w["closes_at"]:
        mins_since = (now - w["closes_at"]).total_seconds() / 60.0
        return {"bookable": False,
                "reason": "booking closed {:.0f} min before departure (notice {} min)".format(
                    mins_since, w["policy"]["min_notice_min"]),
                "minutes_to_close": 0.0,
                "days_to_departure": (depart - now).total_seconds() / 86400.0,
                "window": _iso(w)}
    return {"bookable": True, "reason": None,
            "minutes_to_close": (w["closes_at"] - now).total_seconds() / 60.0,
            "days_to_departure": (depart - now).total_seconds() / 86400.0,
            "window": _iso(w)}


def _iso(w: Dict) -> Dict:
    return {"opens_at": w["opens_at"].isoformat(),
            "closes_at": w["closes_at"].isoformat(),
            "policy": w["policy"]}