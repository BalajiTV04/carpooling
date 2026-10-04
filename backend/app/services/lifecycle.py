"""Trip lifecycle close (Module 19): pure completion rules + receipt math.

WHY a pure module: "when may a trip be completed, and what happens to every
booking at that moment" is business policy that the endpoint, the tests, and
the report all need to agree on. Keeping it here means the API layer only
performs the writes.

Lifecycle (Module 6 machine, closed here):
    draft -> published -> ongoing -> completed        (or -> cancelled)

Completion is allowed from published (driver skipped tracking) or ongoing.
draft/cancelled are refused; completed is refused (not idempotent — a second
POST is a real mistake worth surfacing, the receipt already exists).

Booking resolution at completion (seats are FROZEN — no release):
    requested -> rejected   (auto: "trip completed" — the driver never acted)
    accepted  -> completed  (was going to happen; ride is over)
    confirmed -> completed  (settled money — cost_share is NOT touched)
    rejected/cancelled -> untouched (already terminal)

Money: completed bookings keep the `cost_share` written by Modules 12/13 —
completion only READS it to build the receipt, so a late recalc can never
rewrite history after the driver has seen the final numbers.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

COMPLETABLE_FROM = ("published", "ongoing")

# status -> status applied at completion (absent = leave untouched)
COMPLETION_MAP = {
    "requested": "rejected",
    "accepted": "completed",
    "confirmed": "completed",
}
AUTO_REJECT_NOTE = "trip completed"


def completion_guard(status: Optional[str]) -> Dict:
    """{allowed, reason, from_status} — the single gate the endpoint enforces."""
    if status == "completed":
        return {"allowed": False, "from_status": status,
                "reason": "trip is already completed"}
    if status not in COMPLETABLE_FROM:
        return {"allowed": False, "from_status": status,
                "reason": "only published/ongoing trips can be completed ("
                          + str(status) + ")"}
    return {"allowed": True, "reason": None, "from_status": status}


def resolve_booking(doc: Dict) -> Optional[Dict]:
    """What completion does to ONE booking: {id, from, to, notify} or None."""
    status = doc.get("status")
    target = COMPLETION_MAP.get(status or "")
    if target is None:
        return None
    row = {"id": str(doc["_id"]), "from": status, "to": target,
           "seats": int(doc.get("seats", 1))}
    if status == "requested":
        row["note"] = AUTO_REJECT_NOTE
    return row


def resolve_completion(bookings: List[Dict]) -> Dict:
    """Plan for a whole trip: transitions + counts (no DB, fully testable)."""
    transitions = [r for r in (resolve_booking(b) for b in bookings) if r]
    counts = {"completed": 0, "rejected": 0}
    for t in transitions:
        counts[t["to"]] = counts.get(t["to"], 0) + 1
    return {
        "transitions": transitions,
        "counts": counts,
        "unchanged": len(bookings) - len(transitions),
    }


def _as_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def summarise(trip: Dict, bookings: List[Dict],
              resolved: Optional[Dict] = None) -> Dict:
    """Post-trip receipt: seats sold, money collected, per-passenger rows.

    `bookings` must be the docs AFTER resolution (status == completed) so the
    receipt and the database can never disagree. Duration is derived from
    depart_at/completed_at when both are present.
    """
    resolved = resolved or resolve_completion(bookings)
    rows = []
    seats_sold = 0
    collected = 0.0
    for b in sorted(bookings, key=lambda d: _as_aware(d.get("created_at"))
                    or datetime.min.replace(tzinfo=timezone.utc)):
        if b.get("status") != "completed":
            continue
        seats = int(b.get("seats", 1))
        share = float(b.get("cost_share") or 0.0)
        seats_sold += seats
        collected = round(collected + share, 2)
        rows.append({"booking_id": str(b["_id"]),
                     "passenger_id": str(b.get("passenger_id")),
                     "seats": seats,
                     "cost_share": round(share, 2)})
    depart = _as_aware(trip.get("depart_at"))
    done = _as_aware(trip.get("completed_at"))
    duration_min = None
    if depart is not None and done is not None:
        duration_min = round((done - depart).total_seconds() / 60.0, 1)
    return {
        "trip_id": str(trip["_id"]),
        "status": trip.get("status"),
        "source_name": (trip.get("source") or {}).get("name"),
        "destination_name": (trip.get("destination") or {}).get("name"),
        "distance_km": trip.get("distance_km"),
        "seats_offered": int(trip.get("seats_offered", 0)),
        "seats_sold": seats_sold,
        "occupancy_pct": (round(seats_sold * 100.0 / trip["seats_offered"], 1)
                          if trip.get("seats_offered") else 0.0),
        "passengers": len(rows),
        "collected_total": collected,
        "bookings": rows,
        "auto_rejected": resolved.get("counts", {}).get("rejected", 0),
        "depart_at": depart.isoformat() if depart else None,
        "completed_at": done.isoformat() if done else None,
        "duration_min": duration_min,
        "note": "Seats and money are frozen at completion — cost_share is read, "
                "never rewritten.",
    }
