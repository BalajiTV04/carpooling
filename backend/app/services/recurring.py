"""Recurrence rules (Module 15): dates for daily / weekdays / weekly series.

PURE module — no DB. The API materialises one real trip per date (Option A):
every downstream module (search, booking windows, cost, segments, tracking)
works on instances without knowing they came from a series.

Rules:
- daily     : every day from starts_on (inclusive) to the horizon/stops_on
- weekdays  : Monday..Friday only
- weekly    : only the listed weekdays (0=Mon .. 6=Sun); empty list = base day

stops_on (inclusive) always wins over the horizon. Dates are DATE objects —
time-of-day is applied by the caller from the base trip.
"""
from datetime import date, timedelta
from typing import List, Optional

RULES = ("daily", "weekdays", "weekly")


def _parse_date(date_input: Optional[str]) -> Optional[date]:
    if not date_input:
        return None
    return date.fromisoformat(date_input[:10])


def _clamp_window(starts_on: date, stops_on: Optional[date],
                  horizon_days: int, max_days: int) -> date:
    if stops_on is not None:
        end = stops_on
    else:
        end = starts_on + timedelta(days=horizon_days - 1)
    ceiling = starts_on + timedelta(days=max_days - 1)
    if end < starts_on:
        return end
    if ceiling < end:
        return ceiling
    return end


def materialise_dates(rule: str, starts_on: date,
                      stops_on: Optional[date] = None,
                      weekly_days: Optional[List[int]] = None,
                      horizon_days: int = 21,
                      max_days: int = 90) -> List[date]:
    """Ordered list of dates in the series (inclusive of starts_on)."""
    if rule not in RULES:
        raise ValueError("rule must be " + "|".join(RULES))
    stops_on = _parse_date(stops_on) if isinstance(stops_on, str) else stops_on
    end = _clamp_window(starts_on, stops_on, horizon_days, max_days)
    if end < starts_on:
        return []
    out: List[date] = []
    day = starts_on
    while day <= end:
        if rule == "daily":
            out.append(day)
        elif rule == "weekdays":
            if day.weekday() < 5:  # Mon..Fri
                out.append(day)
        else:  # weekly
            days = weekly_days if weekly_days else [starts_on.weekday()]
            if day.weekday() in days:
                out.append(day)
        day += timedelta(days=1)
    return out


def describe(rule: str, weekly_days: Optional[List[int]] = None) -> str:
    """Human label for the UI ('Weekdays · Mon-Fri', 'Weekly · Mon, Thu')."""
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    if rule == "daily":
        return "Every day"
    if rule == "weekdays":
        return "Weekdays (Mon-Fri)"
    days = sorted(set(weekly_days or []))
    return "Weekly on " + ", ".join(names[d] for d in days) if days else "Weekly"