# Module 19 — Trip completion + receipt (closing the lifecycle)

**Status:** VERIFIED · `pytest tests/test_completion.py` 4/4 (3 pure rules + live start/complete/receipt flow) · driver TripCard Start/Complete/Receipt + passenger completed-settlement strip live.

## 1. Concept / why
Modules 6→17 built a trip *up*; nothing could bring it *down*. Completion is
the moment the platform knows what actually happened — who rode, what money
settled — so it freezes seats, freezes money, resolves every open booking, and
hands the driver a receipt. The key design choice: **completion READS money,
never recomputes it.** The last Modules-12/13 recalc already ran while the
trip was open; the receipt quotes those numbers, so a post-ride formula change
can never rewrite what the driver has seen.

## 2. Prerequisites
- Module 6 statuses (published/ongoing are the only completable ones)
- Modules 12/13 money writer (`persist_segments` runs the final pass)
- Module 11 booking snapshots (what completion reads and freezes)

## 3. Rules (services/lifecycle.py — pure, single source of truth)
- `completion_guard(status)`: published|ongoing → allowed; completed → "already"
  (a second POST is a mistake worth surfacing, not a silent no-op);
  draft|cancelled → 422.
- `resolve_completion(bookings)`: requested → rejected (auto, "trip completed"),
  accepted|confirmed → completed; rejected|cancelled untouched (already terminal).
- `summarise(trip, bookings)`: seats_sold, passengers, collected_total
  (Σ of frozen cost_shares), occupancy %, duration from depart→completed_at.

## 4. Code map - how the pieces connect
- `api/v1/trips.py`: `POST /{id}/start` (explicit published→ongoing, same-gated
  as the tracking ping), `POST /{id}/complete` (guard → persist_segments →
  resolve bookings → stamp completed_at → receipt), `GET /{id}/summary`
  (driver + any passenger holding a booking, completed flag, provisional note
  while the trip is still open — read-only, never touches money).
- Money freeze after completion is structural: segments/cost lock pricing at
  ongoing/completed and rebuild refuses completed trips, so neither path can
  move shares afterwards.
- Models: `BookingOut` gains `closed_at/closure_note`; `Bookings` + `Trips`
  validators gain `closed_at/closure_note` and `started_at/completed_at`.
- Frontend: `lib/trips.ts` start/complete/summary, `TripCard` Start/Complete/
  Receipt buttons + `Receipt` card (seats, occupancy, collected, duration,
  auto-rejected count, per-passenger settled rows), requests page completed
  settlement strip, BookingPanel "Rode ✓ settled ₹x" state (the panel now also
  matches a `completed` booking so a returning rider sees the receipt instead
  of a dead request button).

## 5. Integration
Completes the M6 machine (draft→published→ongoing→completed). First tracking
ping (M17) and the Start button share the published→ongoing step; ratings
(M22) and notifications (M23) attach to the completed state downstream.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_completion.py -v -p no:cacheprovider  # 4 passed
```
Pure: guard states, auto-reject/complete mapping with terminal docs untouched,
receipt math (seats, collected, occupancy, duration). Live: start → ongoing
(404 for non-owners per the Module 6 convention; repeat → 422); complete →
receipt with frozen cost_share; accepted/confirmed → completed, requested →
rejected with closure_note; rider reads receipt, outsider 403; new bookings
refused 422; re-complete 422.

## 7. Common errors
| Error | Fix |
|---|---|
| 422 "already completed" | by design — the receipt from the first call stands; re-read via /summary |
| new bookings 422 after completion | expected — book a recurring sibling (M15), not a finished ride |
| unanswered requests vanish at completion | they don't vanish: they become rejected with `closure_note: trip completed` |

## 8. Commit message
```
feat(completion): close the lifecycle with a frozen receipt

- services/lifecycle pure rules + start/complete/summary endpoints
- final segments persist before flipping; receipts read money, never rewrite
- Bookings gain completed/closed_at/closure_note; trips gain started_at/completed_at
- 4 new tests (pure + live), suite green in isolation
```

## 9. SRS / report notes
- Lifecycle state diagram for the report: every transition named with its
  guard; completion as the only transition that READS four modules (cost,
  segments, bookings, tracking).
- Fairness line: the receipt is honest because the auto-reject count makes
  visible what the driver *didn't* do — unanswered requests, not phantom seats.
- Honest limitation: duration is depart→completed_at (wall-clock), not GPS
  time; `completed` bookings are final in-app but there is no payout ledger
  (out of scope for the project).
