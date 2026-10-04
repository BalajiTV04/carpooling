"""Moderation + dashboard rules (Module 21): pure, no DB, no network.

Two jobs, both policy the endpoints and the report must agree on:

1. `action_guard()` — may THIS admin do THAT to THAT user? The interesting
   cases are the ones examiners ask about: an admin suspending themselves, or
   removing the last admin (which would lock everyone out of the console).
   Pure rules make them testable instead of hopeful.

2. `dashboard()` — turn raw collection counts into the console's cards with
   derived metrics, so the UI and the report quote the same arithmetic.

`sort_alerts()` orders the moderation queue: open before closed, then severity
(critical first), then newest — deterministic, so tests and screenshots match.
"""
from typing import Dict, List, Optional

ASSIGNABLE_ROLES = ("driver", "passenger", "admin")
SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
STATUS_RANK = {"open": 0, "acknowledged": 1, "resolved": 2}

USER_ACTIONS = ("suspend", "reactivate", "role_add", "role_remove")


def action_guard(actor: Dict, target: Dict, action: str,
                 role: Optional[str] = None,
                 admin_count: Optional[int] = None) -> Dict:
    """{allowed, reason} for one moderation action. Never raises."""
    if action not in USER_ACTIONS:
        return {"allowed": False, "reason": "unknown action " + str(action)}
    if "admin" not in (actor.get("roles") or []):
        return {"allowed": False, "reason": "admin role required"}
    if str(actor.get("id")) == str(target.get("_id", target.get("id"))):
        # Self-lockout protection: an admin cannot suspend themselves, nor
        # strip their own admin role (Module 4 made roles additive, so this is
        # the only way a role can be lost).
        return {"allowed": False, "reason": "cannot moderate your own account"}

    target_roles = list(target.get("roles") or [])
    is_last_admin = admin_count is not None and admin_count <= 1
    if action in ("suspend", "role_remove") and "admin" in target_roles \
            and is_last_admin:
        return {"allowed": False,
                "reason": "cannot remove the last admin account"}

    if action == "suspend":
        if target.get("status") != "active":
            return {"allowed": False,
                    "reason": "account is already " + str(target.get("status"))}
        return {"allowed": True, "reason": None}
    if action == "reactivate":
        if target.get("status") == "active":
            return {"allowed": False, "reason": "account is already active"}
        return {"allowed": True, "reason": None}

    # role_add / role_remove
    if role not in ASSIGNABLE_ROLES:
        return {"allowed": False,
                "reason": "role must be " + "|".join(ASSIGNABLE_ROLES)}
    if action == "role_add" and role in target_roles:
        return {"allowed": False, "reason": "user already holds " + role}
    if action == "role_remove":
        if role not in target_roles:
            return {"allowed": False, "reason": "user does not hold " + role}
        if len(target_roles) <= 1:
            return {"allowed": False,
                    "reason": "removing the last role would strand the account"}
    return {"allowed": True, "reason": None}


def sort_alerts(alerts: List[Dict]) -> List[Dict]:
    """Moderation queue order: open first, then severity, then newest."""
    def key(a: Dict):
        created = a.get("created_at")
        return (STATUS_RANK.get(a.get("status"), 9),
                SEVERITY_RANK.get(a.get("severity"), 9),
                -(created.timestamp() if created else 0.0))
    return sorted(alerts, key=key)


def _pct(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return round(numerator * 100.0 / denominator, 1)


def dashboard(users: Dict, trips: Dict, bookings: Dict, alerts: Dict,
              locations: int = 0, vehicles: Optional[Dict] = None) -> Dict:
    """Assemble the console cards from raw counts (all defaulting to 0).

    users    {total, active, suspended, drivers, passengers, admins,
              phone_verified}
    trips    {total, by_status: {...}}
    bookings {total, by_status: {...}}
    alerts   {total, open, by_severity: {...}}
    vehicles {total, pending, verified, rejected}
    """
    vehicles = vehicles or {}
    by_status = trips.get("by_status", {})
    completed = int(by_status.get("completed", 0))
    finished = completed + int(by_status.get("cancelled", 0))
    booking_status = bookings.get("by_status", {})
    sold = int(booking_status.get("confirmed", 0)) \
        + int(booking_status.get("completed", 0))
    severity = alerts.get("by_severity") or {}
    return {
        "users": {
            "total": int(users.get("total", 0)),
            "active": int(users.get("active", 0)),
            "suspended": int(users.get("suspended", 0)),
            "drivers": int(users.get("drivers", 0)),
            "passengers": int(users.get("passengers", 0)),
            "admins": int(users.get("admins", 0)),
            "phone_verified": int(users.get("phone_verified", 0)),
            "verified_pct": _pct(users.get("phone_verified", 0),
                                 users.get("total", 0)),
        },
        "vehicles": {
            "total": int(vehicles.get("total", 0)),
            "pending": int(vehicles.get("pending", 0)),
            "verified": int(vehicles.get("verified", 0)),
            "rejected": int(vehicles.get("rejected", 0)),
        },
        "trips": {
            "total": int(trips.get("total", 0)),
            "by_status": by_status,
            "live": int(by_status.get("ongoing", 0)),
            "completed": completed,
            "completion_rate_pct": _pct(completed, finished),
        },
        "bookings": {
            "total": int(bookings.get("total", 0)),
            "by_status": booking_status,
            "settled_seats": sold,
        },
        "alerts": {
            "total": int(alerts.get("total", 0)),
            "open": int(alerts.get("open", 0)),
            "by_severity": severity,
            "critical_open": int(severity.get("critical", 0)),
        },
        "locations": int(locations),
    }

