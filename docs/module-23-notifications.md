# Module 23 — Notifications (the in-app event feed)

**Status:** VERIFIED · `pytest tests/test_notifications.py` 5/5 (4 pure + live
flow) · full suite green · bell in the NavBar with a 30s summary poll.

## 1. Concept / why
Twenty-two modules produced events — a request arrived, a driver accepted, a
speeding alert opened, a ride finished — and every one of them was silent. The
user had to stare at pages to notice. This module turns platform events into an
in-app feed, declared in **one table** rather than string literals scattered
across booking, safety and trip code.

Two rules shape everything else:
1. **A notification must never break the thing it describes.** A dropped email
   is bad; a failed booking is unacceptable. So `emit()` cannot raise.
2. **A notification can only go to someone who was really there.** Recipients
   are resolved server-side from the actual booking/trip documents.

## 2. Prerequisites
- Modules 11/19 booking transitions, 18 safety alerts, 6 trip lifecycle — all
  already had the exact moment an event should fire
- Module 21's admin role (SOS fan-out targets active admins)

## 3. Rules (services/notify.py — pure, single source of truth)
`EVENT_CATALOG` declares, per event: **priority** (low/normal/high/critical),
**audience** (driver / passenger / admins / driver+admins / other_party),
**dedupe** mode, and the title/body templates.

- `render(event, ctx)` → filled templates, **or `None` for an unknown type**.
  A typo at a future call site is then a no-op, never a 500 on a successful
  booking. `unknown_event()` lets a test pin the typo.
- `dedupe_key(event, ctx)` → the key identifies the **thing**, not the moment:
  - `KEY` events ("your booking was accepted") upsert on
    `(user, dedupe_key)` → exactly one notification, re-emitting is harmless;
  - `NEVER` events (**SOS**, alert ack/resolve) return `None` → every
    occurrence is its own row. Two SOS presses are two real emergencies.
- `sort_key()` — unread first, then priority (critical before normal), then
  newest: the feed never reorders under the user as things are read.
- `unread_summary()` — `{unread, critical, by_type}` for the bell.

## 4. Code map — how the pieces connect
- `api/v1/notifications.py` holds both the read routes and the `emit()` write
  path every other module calls.
  - `_recipients()` resolves the catalog's audience against the **real**
    booking/trip, so a passenger can never be notified about someone else's
    ride, and `other_party` always means "the person who did not trigger it".
  - `emit()` never raises: it returns `{emitted, skipped, error}` and logs a
    warning, so a failure is visible in the server log without breaking the
    caller's response.
  - Routes: `GET /notifications`, `GET /summary`, `POST /{id}/read` (own only —
    someone else's is 404), `POST /read-all` (scoped to me).
- **Emission points wired in:** booking requested → driver; accepted /
  rejected → passenger; cancelled → the other party; SOS → driver **+ every
  active admin**; new safety alert → driver + admins; alert acknowledged →
  admins; trip completed → each rider (`action: "rate"`, which Module 22
  consumes). Call sites use lazy imports, matching the existing pattern for
  `segments` / `safety`, and `bookings._notify()` double-wraps so a
  notification can never fail a booking transition.
- Schema + indexes in all four mirrors: `schemas/notifications.json`,
  `indexes/05-notifications.mongosh.js`, `app/core/indexes.py`,
  `db_admin.COLLECTIONS`.
  **The dedupe index is `unique` + `sparse`, and that is load-bearing:** NEVER
  events omit `dedupe_key` entirely, and a non-sparse unique index would
  collide on those missing fields. Pinned by a test.
- Frontend: `lib/notify.ts`, `NotificationBell.tsx` (count badge, feed drawer,
  per-item and mark-all-read) in the NavBar; `/requests` now also shows the
  Module 22 prompt on completed rides, so the bell's "rate" action has a real
  destination.

## 5. Integration
Sits on top of every other module and writes to none of their state. It is the
first consumer of Module 22's "rate your ride" nudge, and the admin SOS fan-out
is the synopsis's *"administrator notifications"* requirement.

## 6. Run + test (verified)
```powershell
cd backend
python -m pytest tests/test_notifications.py -v -p no:cacheprovider  # 5 passed
```
Pure: every catalog event renders with no leftover `{placeholder}` and a valid
priority; context substitution plus defaults (never the string "None");
dedupe keys for KEY vs NEVER events and the no-anchor case; unread summary and
the three-level sort. Live: request notifies the **driver only** (passenger and
stranger untouched, names rendered); accept notifies the passenger and does not
repeat the request; two SOS presses produce **two** critical notifications for
the admin *and* the driver; re-emitting a KEY event emits 0; completion emits
one `trip_completed` with `action: "rate"`; an unknown event is ignored, not a
500; mark-one-read, another user's notification 404, mark-all-read, and
read-all proven scoped to the caller.

## 7. Common errors
| Error | Meaning |
|---|---|
| Bell stays at 0 | notifications are in-app only and need a logged-in session; the poll runs every 30s |
| SOS not delivered to an admin | only **active** admins are recipients (M21 suspend revokes delivery) |
| Acceptance notified twice | it should not be — `KEY` dedupe is enforced by the unique index; if you see it, the index is missing |
| A `rate` action has no "open" link | expected for `live` actions: there is no per-trip route yet, so the bell shows a label instead of a dead link |

## 8. Commit message
```
feat(notifications): one event catalog, one emit() that never breaks a caller

- services/notify pure catalog: priority, audience, dedupe mode, templates
- KEY events upsert per (user, thing); SOS/ack/resolve are NEVER deduped
- wired into bookings, SOS, safety alerts, ack and trip completion
- sparse-unique dedupe index; unknown events are a no-op, not a 500
- 5 tests (4 pure + live), NavBar bell with a 30s summary poll
```

## 9. SRS / report notes
- The catalog doubles as the report's notification requirements matrix: event,
  trigger, recipient, priority, and dedupe policy in one table.
- Reliability argument for the viva: `emit()` is total (it cannot raise), and
  every call site is additionally wrapped, so notification state can never
  influence the outcome of a booking, a trip or a safety alert.
- Honest limitations: **in-app only** — there is no email or SMS provider in
  the stack, and none is simulated; the bell **polls** (30s summary) because
  Module 20's hub is trip-scoped, and a user-level push channel would need a
  shared bus (Redis/NATS); the feed is capped at 50 without pagination; and
  notifications are not retained/expired by any TTL.
