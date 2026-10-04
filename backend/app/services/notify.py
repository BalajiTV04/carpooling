"""Notification events (Module 23): pure, no DB, no network.

Every notification in the platform is declared in EVENT_CATALOG, so the set of
things a user can be told is a readable table rather than string literals
scattered across booking/safety/trip code.

Each event declares:
  priority  low | normal | high | critical  (bell colour + sort order)
  audience  who receives it — resolved by the API, declared here so the rules
            are reviewable in one place:
              driver | passenger | admins | driver+admins | other_party
  dedupe    "key"  -> at most one per (user, dedupe_key); derived facts such as
                     "your booking was accepted" must not repeat
            "never" -> every occurrence is its own notification; used for SOS,
                     where two presses are two real events
  title/body  templates rendered by `render()` from a small context dict

`render()` returns None for an unknown type on purpose: a typo at a future
call site must never turn a successful booking into a 500. The emitter skips
it, and `unknown_event()` lets a test pin the typo instead.

HONEST SCOPE: in-app only. The project has no email/SMS provider, and Module
20's hub is deliberately trip-scoped, so user-level fan-out uses incremental
polling (`?since=`). Both limits are stated in docs/module-23-notifications.md.
"""
from datetime import datetime
from typing import Dict, Iterable, List, Optional

PRIORITY_RANK = {"critical": 0, "high": 1, "normal": 2, "low": 3}
NEVER = "never"
KEY = "key"

# audience keys
DRIVER, PASSENGER, ADMINS, DRIVER_ADMINS, OTHER_PARTY = (
    "driver", "passenger", "admins", "driver+admins", "other_party")

EVENT_CATALOG: Dict[str, Dict] = {
    "booking_requested": {
        "priority": "normal", "audience": DRIVER, "dedupe": KEY,
        "title": "New ride request",
        "body": "{passenger} wants {seats} seat(s) on {route}.",
    },
    "booking_accepted": {
        "priority": "normal", "audience": PASSENGER, "dedupe": KEY,
        "title": "Your request was accepted",
        "body": "{driver} accepted your booking on {route}. Confirm to lock it in.",
    },
    "booking_rejected": {
        "priority": "normal", "audience": PASSENGER, "dedupe": KEY,
        "title": "Your request was declined",
        "body": "{driver} declined your booking on {route}.",
    },
    "booking_cancelled": {
        "priority": "normal", "audience": OTHER_PARTY, "dedupe": KEY,
        "title": "Booking cancelled",
        "body": "{who} cancelled a booking on {route}.",
    },
    "trip_completed": {
        "priority": "normal", "audience": PASSENGER, "dedupe": KEY,
        "title": "Trip completed — rate your ride",
        "body": "Your ride on {route} is finished. Rate {driver} in one tap.",
        "action": "rate",
    },
    "trip_started": {
        "priority": "normal", "audience": PASSENGER, "dedupe": NEVER,
        "title": "Your trip has started",
        "body": "{driver} is driving {route}. Live tracking is now available.",
        "action": "live",
    },
    "safety_alert": {
        "priority": "high", "audience": DRIVER_ADMINS, "dedupe": KEY,
        "title": "Safety alert: {kind}",
        "body": "{kind} alert on {route}. {detail}",
    },
    "sos": {
        "priority": "critical", "audience": DRIVER_ADMINS, "dedupe": NEVER,
        "title": "SOS — emergency alert",
        "body": "{who} sent an SOS on {route}. {detail}",
    },
    "alert_acknowledged": {
        "priority": "normal", "audience": ADMINS, "dedupe": NEVER,
        "title": "Alert acknowledged",
        "body": "{who} acknowledged the {kind} alert on {route}.",
    },
    "alert_resolved": {
        "priority": "low", "audience": DRIVER, "dedupe": NEVER,
        "title": "Alert resolved",
        "body": "The {kind} alert on {route} was closed by an administrator.",
    },
    "recurring_created": {
        "priority": "normal", "audience": DRIVER, "dedupe": KEY,
        "title": "Recurring series created",
        "body": "{count} ride(s) scheduled as part of your {label} series.",
    },
}

# fields the templates may reference; anything else is ignored
TEMPLATE_FIELDS = ("passenger", "driver", "who", "seats", "route", "kind",
                   "detail", "count", "label")

def _fmt(value, fallback: str) -> str:
    if value is None or value == "":
        return fallback
    if isinstance(value, float):
        return str(round(value, 1))
    return str(value)


def render(event: str, ctx: Optional[Dict] = None) -> Optional[Dict]:
    """{type, title, body, priority, action, dedupe} or None for unknown types."""
    spec = EVENT_CATALOG.get(event)
    if spec is None:
        return None
    ctx = ctx or {}
    values = {k: _fmt(ctx.get(k), defaults) for k, defaults in (
        ("passenger", "A rider"), ("driver", "The driver"), ("who", "Someone"),
        ("seats", 1), ("route", "your trip"), ("kind", "safety"),
        ("detail", ""), ("count", 0), ("label", "recurring"))}
    return {
        "type": event,
        "title": spec["title"].format(**values),
        "body": spec["body"].format(**values),
        "priority": spec["priority"],
        "action": spec.get("action"),
        "dedupe": spec["dedupe"],
    }


def dedupe_key(event: str, ctx: Optional[Dict] = None) -> Optional[str]:
    """Stable per-entity key, or None when the event is NEVER deduped.

    The key identifies the THING (a booking, a trip+kind), not the moment, so
    re-running an emission path is harmless.
    """
    spec = EVENT_CATALOG.get(event)
    if spec is None or spec["dedupe"] == NEVER:
        return None
    ctx = ctx or {}
    if event in ("booking_requested", "booking_accepted", "booking_rejected",
                 "booking_cancelled", "trip_completed"):
        anchor = ctx.get("booking_id") or ctx.get("trip_id")
    elif event == "safety_alert":
        anchor = "{}-{}".format(ctx.get("trip_id"), ctx.get("kind"))
    elif event == "recurring_created":
        anchor = ctx.get("group_id") or ctx.get("trip_id")
    else:
        anchor = ctx.get("trip_id") or ctx.get("booking_id")
    if not anchor:
        return None
    return "{}:{}".format(event, anchor)


def sort_key(notification: Dict) -> tuple:
    """Unread first, then priority, then newest — stable so the UI never jumps."""
    created = notification.get("created_at")
    ts = created.timestamp() if isinstance(created, datetime) else 0.0
    return (0 if not notification.get("read_at") else 1,
            PRIORITY_RANK.get(notification.get("priority"), 9), -ts)


def unread_summary(notifications: Iterable[Dict]) -> Dict:
    """{unread, critical, by_type} for the nav bell."""
    unread = critical = 0
    by_type: Dict[str, int] = {}
    for n in notifications or []:
        if n.get("read_at"):
            continue
        unread += 1
        if n.get("priority") == "critical":
            critical += 1
        key = str(n.get("type"))
        by_type[key] = by_type.get(key, 0) + 1
    return {"unread": unread, "critical": critical, "by_type": by_type}


def sorted_feed(notifications: Iterable[Dict], limit: Optional[int] = None) -> List[Dict]:
    rows = sorted(notifications or [], key=sort_key)
    return rows[:limit] if limit else rows


def unknown_event(event: str) -> bool:
    """True for a type missing from the catalog — lets a test pin a typo."""
    return event not in EVENT_CATALOG
