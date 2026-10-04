"""Rating rules (Module 22): pure, no DB, no network.

Ratings only mean something once a ride has actually happened, so the policy
lives here where the endpoint, the tests, and the report all read the same
rules:

- `validate_stars()` — 1..5 whole stars, nothing else.
- `rating_eligibility()` — WHO may rate WHOM on a booking, in the order a
  reviewer would ask about it:
    1. the rater must be a PARTY to the booking (a stranger rates nobody);
    2. the booking must be `completed` — a rating is a statement about a ride
       that happened, so cancelled/open bookings are not ratable;
    3. the target is always the OTHER party, so self-rating is impossible.
  Each refusal carries a `code` so the API can answer 403 (not your booking)
  vs 422 (nothing to rate yet) without re-deriving the logic.
- `aggregate()` — avg/count recomputed from the ratings collection. The value
  cached on the user document is a cache of this function, never an
  independent `$inc` ledger, so a crash between the two writes cannot leave a
  drifted score (same "one writer, derived state" discipline Module 19 used
  for frozen money).
- `distribution()` — the 1..5 histogram for a public profile card.

One rating per (booking, rater), enforced by a unique index: re-posting the
same booking UPDATES that rater's score instead of adding a second vote.
"""
from typing import Dict, Iterable, List, Optional

MIN_STARS = 1
MAX_STARS = 5
MAX_COMMENT = 500
RATABLE_STATUS = "completed"


def validate_stars(stars) -> Dict:
    """{ok, stars|None, reason} — accepts ints and integral floats, never bool."""
    if isinstance(stars, bool):
        return {"ok": False, "stars": None, "reason": "stars must be a number"}
    try:
        value = float(stars)
    except (TypeError, ValueError):
        return {"ok": False, "stars": None, "reason": "stars must be a number"}
    if value != int(value):
        return {"ok": False, "stars": None, "reason": "stars must be a whole number"}
    value = int(value)
    if value < MIN_STARS or value > MAX_STARS:
        return {"ok": False, "stars": None,
                "reason": "stars must be " + str(MIN_STARS) + "-" + str(MAX_STARS)}
    return {"ok": True, "stars": value, "reason": None}


def clean_comment(text: Optional[str]) -> Optional[str]:
    """Collapse whitespace, trim to MAX_COMMENT, empty -> None."""
    if text is None:
        return None
    squashed = " ".join(str(text).split())
    if not squashed:
        return None
    return squashed[:MAX_COMMENT]


def rating_eligibility(booking: Dict, user_id: str) -> Dict:
    """{allowed, reason, code, target_id} for rating this booking as `user_id`."""
    uid = str(user_id)
    passenger = str(booking.get("passenger_id"))
    driver = str(booking.get("driver_id"))
    if uid not in (passenger, driver):
        return {"allowed": False, "code": "forbidden", "target_id": None,
                "reason": "not a party to this booking"}
    state = booking.get("status")
    if state != RATABLE_STATUS:
        return {"allowed": False, "code": "unprocessable", "target_id": None,
                "reason": "only completed rides can be rated (this one is "
                          + str(state) + ")"}
    target = driver if uid == passenger else passenger
    if target == uid:  # unreachable while passenger_id != driver_id, but never
        return {"allowed": False, "code": "forbidden", "target_id": None,
                "reason": "you cannot rate yourself"}  # allow a self-rating bug
    return {"allowed": True, "code": None, "target_id": target, "reason": None}


def _clean_stars(docs: Iterable[Dict]) -> List[int]:
    stars: List[int] = []
    for doc in docs or []:
        try:
            value = int(doc.get("stars"))
        except (TypeError, ValueError):
            continue
        if MIN_STARS <= value <= MAX_STARS:
            stars.append(value)
    return stars


def aggregate(docs: Iterable[Dict]) -> Dict:
    """{avg, count} over the ratings a user RECEIVED. avg is None when empty."""
    stars = _clean_stars(docs)
    if not stars:
        return {"avg": None, "count": 0}
    return {"avg": round(sum(stars) / float(len(stars)), 2), "count": len(stars)}


def distribution(docs: Iterable[Dict]) -> Dict:
    """{'1'..'5': n} — every bucket present, so the UI can render bars safely."""
    out = {str(i): 0 for i in range(MIN_STARS, MAX_STARS + 1)}
    for value in _clean_stars(docs):
        out[str(value)] += 1
    return out


def rateable_rows(bookings: Iterable[Dict], user_id: str,
                  my_ratings: Optional[Dict] = None) -> List[Dict]:
    """One row per completed booking where `user_id` is a party.

    `my_ratings` maps booking_id -> stars for scores this user already left, so
    a row can show "you rated 4 — update" instead of disappearing from the
    list. Pure, so the pending-ratings screen is unit-testable.
    """
    left = {str(k): v for k, v in (my_ratings or {}).items()}
    rows: List[Dict] = []
    for booking in bookings or []:
        verdict = rating_eligibility(booking, user_id)
        if not verdict["allowed"]:
            continue
        booking_id = str(booking.get("_id"))
        rows.append({
            "booking_id": booking_id,
            "trip_id": str(booking.get("trip_id")),
            "target_id": verdict["target_id"],
            "seats": int(booking.get("seats", 1) or 1),
            "closed_at": booking.get("closed_at"),
            "my_stars": left.get(booking_id),
        })
    return rows