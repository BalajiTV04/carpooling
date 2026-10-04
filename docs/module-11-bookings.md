# Module 11 — Booking flow
**Status:** VERIFIED · `pytest` 36/36 (10-step booking lifecycle live) · `/requests` + in-card `BookingPanel` live.

## 1. Concept / why
A booking is a NEGOTIATED RESERVATION, not a click-to-buy: seats must survive
concurrent requests (two passengers grabbing the last seat), and both sides
must agree (driver accepts, passenger confirms). The atomic trick: the
**request** reserves seats via a single conditional Mongo update —
`$expr: { $lte: [{$add: ["$seats_booked", seats]}, "$seats_offered"] }` +
`$inc` — so overselling is impossible even under races; reject/cancel release
the seats; accept/confirm never touch the counter. Snapshots freeze the deal
at request time: the Module 10 optimised pickup point (walk/door strategy +
`detour_km` + `pickup_distance_m`) and the Module 9 `overlap_pct` — later
route edits can't rewrite history, and Module 12 prices what was agreed.

Status machine: `requested → accepted → confirmed`, with `rejected`
(driver, seats back) and `cancelled` (either party, seats back while the trip
is still `published`).

## 2. Prerequisites
- Modules 7–10 (route geometry, matching, pickup optimiser) · verified phone
- No new deps; `bookings` validator/indexes already exist from Module 2

## 3. DB changes + endpoints
No schema change (uses fields pre-declared in Module 2: `pickup_distance_m`,
`detour_km`, `overlap_pct`, `match_explain`, `cost_share`).
Endpoints: `POST /bookings` · `GET /bookings/mine` (passenger) ·
`GET /bookings/incoming` (driver) · `GET /bookings/{id}` (party-only) ·
`POST /bookings/{id}/accept|reject|confirm|cancel`.

## 4. Code map
- `models/booking.py` — BookingIn (coords validated, `use_optimised_pickup`),
  BookingOut (expanded trip + names + status).
- `api/v1/bookings.py` — create (gates: verified phone → not own trip →
  published → future → no duplicate active → M10/M9 snapshots → ATOMIC
  reservation), transitions (role-checked + status-guarded, seats released on
  reject/cancel), `_out` expansion (trip + vehicle + names).
- `tests/test_bookings.py` — 10-step live flow: unverified 403, own-trip 422,
  create+reserve+snapshots, duplicate 409, pax-accept 403, confirm-before-
  accept 422, accept→confirm (counter unchanged), last-seat + third-request
  409, reject releases, both views, cancel releases + double-cancel 422.
- Frontend: `lib/bookings.ts` · `components/BookingPanel.tsx` (in-card state
  machine with waiting/confirm/locked-in states) · `app/requests/page.tsx`
  (role-aware panes: "My requests" / "Incoming" with Accept·Reject) ·
  NavBar links (Find ride / Requests / My trips).

## 5. Integration
Consumes M10 optimiser + M9 matcher at request time; writes `seats_booked`
consumed by M6 floor check and M8 search; `cost_share` stays `None` until
Module 12 fills it; Module 13 recalculates when new passengers join;
Module 23 notifies on every transition.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 36 passed
```
Frontend: `/search` → View a card → Booking panel → "Request booking →" →
switch to driver account → `/requests` → Incoming → Accept → back as
passenger → Requests → Confirm ✓ (pill turns lime).

## 7. Common errors
| Error | Fix |
|---|---|
| 403 verify phone | bookings need a verified number (safety: contactability) |
| 409 not enough seats | counter check — search another trip or fewer seats |
| 409 already active booking | one active request per trip per passenger |
| 422 only requested/accepted… | status machine guard — refresh the panel |
| seats didn't release | release only happens while trip is `published` (ongoing trips freeze accounting) |

## 8. Commit message
```
feat(bookings): negotiated flow with atomic seat reservation

- conditional $inc reserve/release, accept/reject/confirm/cancel transitions
- M10 pickup + M9 match snapshots frozen on booking; expansions with names
- 10-step live test; BookingPanel + /requests role-aware UI; 36/36 green
```

## 9. SRS / report notes
- State diagram + concurrency argument (single-document conditional update =
  no read-modify-write race; cite `modified_count == 0` → 409).
- Snapshot rationale: immutable agreement record for dispute-free cost split.
- Viva line: "accept/confirm are O(1) status flips; only request/reject/cancel
  touch the seat counter — the invariant `Σ booking.seats(active) =
  seats_booked` holds at every step."