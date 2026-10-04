# Module 22 — Ratings & reviews (the trust layer)

**Status:** VERIFIED · `pytest tests/test_ratings.py` 7/7 (6 pure rules + live
flow) · full suite green · passenger BookingPanel + driver TripCard receipt
prompt · `/me` review card with histogram.

## 1. Concept / why
Modules 6–21 built a ride from search to receipt. Nothing let either side say
what it was actually like. Ratings close that loop, and the *only* honest place
to ask is **after a ride has finished** — so this module is deliberately the
narrowest one in the project: one number (1–5) plus an optional note, between
the two people who actually shared a vehicle.

The design choice that matters: **the `ratings` collection is the source of
truth and the score on the user document is a cache of a pure function over
that collection.** No `$inc` ledger. A rating is therefore always recomputable,
and a crash between the rating write and the aggregate write cannot leave a
drifted score — the same discipline Module 19 applied to frozen money.

## 2. Prerequisites
- Module 19 `completed` bookings (the `status == "completed"` gate is the whole
  precondition — no completed ride, no rating)
- Module 4's `users.rating_avg` / `rating_count` fields, which Module 4
  declared read-only and this module now writes
- Module 21's user board, which shows the score with no extra work

## 3. Rules (services/ratings.py — pure, single source of truth)
- `validate_stars()` — 1–5 whole numbers; `4.0` is accepted, `4.5`, `True`,
  `0`, `6` and junk are not.
- `rating_eligibility(booking, user_id)` — three gates in reviewer order, each
  carrying a `code` so the API answers the right status without re-deriving:
  1. must be a **party** → `forbidden` (403);
  2. booking must be **completed** → `unprocessable` (422);
  3. the target is always the **other** party, so self-rating is impossible.
- `aggregate()` / `distribution()` — avg (2 dp, rounded not truncated), count,
  and a `'1'..'5'` histogram that always has all five buckets so the UI can
  render bars without null-guards. Junk rows are skipped, not averaged in.
- `rateable_rows()` — one row per completed booking I was part of, carrying
  `my_stars` so an existing review shows as "update" instead of vanishing.

## 4. Code map — how the pieces connect
- `api/v1/ratings.py`: `POST /ratings` (upsert on the unique pair, then
  `_recompute`), `GET /ratings/pending` (both roles, newest first),
  `GET /ratings/booking/{id}` (parties + admin only), `GET /ratings/user/{id}`
  (public card). `_recompute()` is the single writer of the cached aggregate.
- **One vote per ride is enforced by the index, not by application code**:
  `uq_ratings_booking_rater` on `(booking_id, rater_id)`. Re-posting the same
  booking *edits* the review (full replace — omitting the comment clears it,
  which the UI avoids by prefilling the textarea).
- Models: `RatingIn` / `RatingOut` / `RatingCard` in `app/models/rating.py`.
  `app/models/` stays a leaf, so the 1–5 bounds are literals there while
  `services.ratings` holds the canonical constants — and
  `test_model_bounds_agree_with_service_constants` pins the two together.
- Schema + indexes added in all four places that must agree:
  `database/schemas/ratings.json`, `database/indexes/04-ratings.mongosh.js`,
  `app/core/indexes.py`, `db_admin.COLLECTIONS`.
- Frontend: `lib/ratings.ts`, `StarPicker.tsx` (interactive; `Stars.tsx` stays
  the read-only display), `RateRideCard.tsx` (shared by both sides), mounted
  in the passenger `BookingPanel` completed state and in the driver `TripCard`
  receipt, plus a `ReviewsCard` on `/me` with the histogram.

## 5. Integration
Completes the lifecycle: M19 closes the ride → M22 asks the two parties what
it was like → the score feeds M4's public card, M8's trip listings and M21's
console. Module 23 (notifications) will use `pending` as the "rate your ride"
nudge. Ratings are strictly **read-only** against `cost_share` — the trust
layer never touches money.

## 6. Run + test (verified)
```powershell
cd backend
python -m pytest tests/test_ratings.py -v -p no:cacheprovider  # 7 passed
```
Pure: star bounds + Pydantic/service drift guard, comment cleaning, the full
eligibility matrix (stranger 403 / five unfinished states 422 / both
directions), aggregate rounding and junk-row rejection, histogram, and
`rateable_rows`. Live: confirmed-but-not-completed → 422; complete the trip →
both sides get a pending row and a stranger gets none; stranger rates → 403;
passenger rates → 5.0; re-rate → 3.0 with the count still 1 (one document);
cached `users` aggregate matches; reciprocal rating; public card aggregate +
histogram + feed; the Module 4 profile shows the score; the booking thread has
both reviews and is 403 for a stranger; out-of-range stars 422; the Module 21
console shows the score.

## 7. Common errors
| Error | Meaning |
|---|---|
| 422 "only completed rides can be rated" | the ride is still open — complete it first (M19) |
| 403 "not a party to this booking" | you were not on that ride; strangers rate nobody |
| Score looks unchanged after re-rating | the response returns the recomputed `target_rating_avg`; check you are reading the *target's* card, not the rater's |
| `count` stays 1 after two POSTs | that is the guarantee, not a bug: one vote per person per ride |

## 8. Commit message
```
feat(ratings): trust layer — one review per person per completed ride

- services/ratings pure rules; aggregate recomputed, never $inc'd
- unique (booking, rater) index makes one-vote-per-ride structural
- pending/booking/user endpoints; both roles prompted from M19's completed state
- 7 tests (6 pure + live), ratings collection wired into all 4 schema mirrors
```

## 9. SRS / report notes
- The eligibility chain is the report's "who may review whom" table: party →
  completed → other party, with the exact HTTP code for each refusal.
- Fairness line: a rating can only exist where money was frozen, so the trust
  signal and the financial record are anchored to the same event.
- Honest limitations: no moderation of comment text (an admin can suspend the
  author via M21 but cannot edit a review), no driver reply, no rating of a
  trip as a whole (only of a person, and only per booking), and the public feed
  is capped at 20 rather than paginated.
