# Module 12 — Cost estimation engine (MVP COMPLETE 🎉)
**Status:** VERIFIED · `pytest` 44/44 (7 pure cost units + pricing/share live flow) · pricing editor live in `/trips`, share strip live in booking panel.

## 1. Concept / why
The deal must be FAIR and the driver must never profit — that constraint
shapes everything. Total trip cost is fuel-only:
`total = distance_km ÷ mileage_kmpl × fuel_price` (mileage from the car,
₹/unit from the trip's policy then per-fuel defaults; missing mileage falls
back to 15 kmpl, stated in the API). Three configurable policies on the trip:
`split_equal` (total ÷ (1 + passengers) — driver rides free, more riders =
everyone pays less), `per_seat` (total × your seats ÷ seats offered —
pricing-stable for passengers, driver eats empty seats), `split_riders`
(total × your seats ÷ confirmed seats — riders cover the whole bill).
Every policy caps Σ passenger shares ≤ total by construction (proved in
tests), and rounding residue lands on the last confirmed booking so sums are
exact. Module 13 will upgrade this whole-trip split to per-segment dynamic
shares; the policy knob and `cost_share` field already belong to both.

## 2. Prerequisites
- Modules 5–6 + 11 (vehicle mileage, trip distance, confirmed bookings) ·
  `bookings.cost_share` already declared in Module 2 (now written for the
  first time)

## 3. DB changes + endpoints
`trips.price_policy {mode, fuel_price?, set_at}` (owner-settable on
draft/published only). New endpoints: `POST /trips/{id}/pricing` →
`GET /trips/{id}/cost` (totals, per-seat estimate, live distribution,
`projected_share_if_book_1_seat_now`) → `GET /bookings/{id}/cost` (your
share + formula inputs). Recalculation hook: accept/reject/confirm/cancel
all call `recalculate_trip_shares()` → persists `cost_share` on every
confirmed/accepted booking (join/leave events).

## 4. Code map
- `services/cost.py` — `resolve_fuel_price` (policy wins, else per-fuel
  defaults), `total_fuel_cost` (litres + per-km shown), `passenger_share`
  (mode math + driver-profit cap), `distribute` (rounding-residue handling).
- `core/config.py` + `.env.example` (root + backend) — ₹/unit prices, default
  mileage 15, default policy `split_equal` (env-tunable, viva-ready).
- `api/v1/cost.py` — pricing owner-gate + status window; trip cost preview;
  booking breakdown with the human formula (`total / (1 + passengers)` etc.);
  `recalculate_trip_shares()` helper shared with bookings.py (lazy import in
  bookings to avoid a router cycle).
- `tests/test_cost.py` — pure: BLR-corridor total (30 km / 18 kmpl × 104.5 =
  ₹174.17), default-mileage path, no-profit cap under all policies,
  split_equal shrinks 100→50 as riders join, per_seat stability, residue
  absorption, policy-wins price. Live: default pricing math, accept persists
  share, second join reshares both to /3, booking breakdown + formula, mode
  switch to per_seat, 422 bad mode, 403 stranger pricing.
- Frontend: `lib/cost.ts` + `components/TripCostCard.tsx` (driver: fuel /
  per-seat / collected tiles, policy picker with plain-language blurbs,
  fuel-price override) in `TripCard` behind "Cost ₹"; `BookingPanel` gains
  `CostStrip` (your ₹share + formula) on confirmed bookings and `CostPreview`
  (est. share) while requesting.

## 5. Integration
Reads vehicle mileage + trip distance (M5/6), confirmed bookings (M11);
`cost_share` snapshot is what M13 refines per segment; policy/explain data
feeds the M16 feature set later. Pre-booking estimate uses the same code
path as post-booking math — no two formulas to drift apart.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 44 passed
# Manual: driver → /trips → Cost ₹ → policy split_equal → Save →
# GET /trips/{id}/cost shows total ₹174.17-class math for your trip
```
Frontend: passenger sees "Est. share if you book now: ₹87.08" while
requesting; after confirm, "₹58.11 your share · total / (1 + passengers)".

## 7. Common errors
| Error | Fix |
|---|---|
| `cost_share` stays null | only persisted on accept+ — requested bookings show previews, not shares |
| totals look wrong | check vehicle mileage (blank → 15 kmpl default) and policy fuel_price override |
| 422 pricing fixed | trips lock pricing at ongoing/completed — set policy before that |
| sum doesn't equal total (split_equal) | by design — driver's slice is uncollected; per_seat/split_riders sum exactly |

## 8. Commit message
```
feat(cost): fuel-based totals + three share policies, priced end-to-end

- services/cost: fuel math, policy shares, no-profit cap, residue handling
- pricing endpoint, trip/booking cost previews, recalc on join/leave
- 15 new tests (7 pure + 8-step live flow); 44/44 green
- UI: driver TripCostCard, passenger CostStrip + CostPreview
- MVP COMPLETE: setup→db→auth→profile→vehicles→trips→maps→search→booking→cost
```

## 9. SRS / report notes
- Cost formula box + the three policies with worked BLR-corridor numbers
  (₹174.17 total → split_equal: ₹87.08/₹58.11; per_seat on 3 seats: ₹58.06).
- No-profit-capped fairness argument (viva: "prove the driver can't profit" —
  cite the cap test + `min(share, total)`).
- MVP test script for the report: the 8-module loop plus one booking plus
  "est. share → confirm → share persists" screenshot pair.
- Handover: Module 13 keeps policy + `cost_share` but splits by segment
  occupancy; state that limitation explicitly ("whole-trip splits ignore
  who rides which leg").