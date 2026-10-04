# Module 21 — Admin operations console (safety net with receipts)

**Status:** VERIFIED · `pytest tests/test_admin.py` 5/5 (3 pure rule suites + full live lockout/moderate/resolve flow) · `/admin` console (cards, alert queue, trip board, user search) live.

## 1. Concept / why
Safety was the priority order's head but had no human behind it: alerts fired
(M18) with nobody to resolve them, vehicles waited on verification nobody
could grant, and there was no way to stop abuse. The console is the operations
answer — but the deeper design point is the **self-lockout guard**: an admin
cannot suspend themselves or remove the last admin, encoded as pure rules, so
the platform can never be operated into an unrecoverable corner.

## 2. Prerequisites
- Module 3 role gates (`require_roles("admin")`; admin is DB-promoted only —
  the console inherits that trust, adding no new privilege path)
- Modules 5/6/11/18 collections to inspect and moderate
- Module 20 `hub.stats()` for the push-observability card

## 3. Moderation rules (services/moderation.py — pure)
- `action_guard(actor, target, action, role?, admin_count?)`: non-admins out;
  no self-suspension or self-role-removal; last-admin protection on suspend
  AND role_remove of admin; suspend/reactivate state transitions; role_add
  duplicates, role_remove missing, last-role strand, and unknown roles all
  refused with named reasons.
- `sort_alerts()`: open → acknowledged → resolved, then critical → low, then
  newest — the order an operator works in, deterministic for tests/screenshots.
- `dashboard()`: raw counts → cards + verified_pct, completion_rate_pct,
  settled_seats, critical_open — the console and the report quote one function.

## 4. Code map - how the pieces connect
- `api/v1/admin.py`: `GET /stats` (all cards incl. stream + generated_at),
  `GET /users` (name/phone search + status/role filters + validation), suspend/
  reactivate (live JWTs die immediately via the M3 status re-check), `/roles`
  add/remove, `GET /trips` (cross-driver board with tracked/open_alerts/
  recurring flags), `GET /alerts` (moderation order + trip/driver enrichment),
  `POST /alerts/{id}/resolve` (records `resolved_by`; double-resolve is 422).
- Frontend: `lib/admin.ts`, `/admin` page (8 stat cards, alert/trip/car/user
  tabs, suspend/reactivate, verify/reject, resolve actions), `Console` link in
  NavBar for admins only, `RequireAuth(["admin"])` gate reuses the existing
  guard. The vehicle-verification tab calls the Module 5 admin routes through
  `adminApi.pendingVehicles()/verifyVehicle()` — surfaced, not duplicated.

## 5. Integration
Reads every operational collection, writes only status/role/alert resolutions;
`resolved_by` on alerts is the audit receipt. Ratings (M22) and notifications
(M23) consume `safety_alerts` and the admin surface without changing this API.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_admin.py -v -p no:cacheprovider  # 5 passed
```
Pure: self/last-admin blocks, suspend lifecycle, role add/remove/strand/invalid,
queue ordering, derived metrics + zero-safe division. Live: non-admin 403 on
every route; stats cards + stream; search/filters + 422s; self-suspend 422;
suspend → live token dies (403 on /users/me AND on login); reactivate restores;
roles add/remove/strand/bad-role; trip board with driver + alert count; alert
queue ordering + enrichment; resolve with timestamp; double-resolve 422.

## 7. Common errors
| Error | Fix |
|---|---|
| 403 on every console route | expected — promote via `db.users.updateOne({phone}, {$set: {roles: ["admin"]}})`; Module 3 refuses self-registering as admin |
| 422 "your own account" | by design — ask another admin to moderate you |
| suspended user can still log in with an old token | they can't: every request re-reads `status` (Modules 3/21 contract, tested) |

## 8. Commit message
```
feat(admin): operations console with self-lockout-safe moderation

- services/moderation pure guards + queue order + dashboard cards
- stats/users/suspend/reactivate/roles/trips/alerts/resolve endpoints
- /admin console page + NavBar link; RequireAuth admin gate reused
- 5 new tests, suite green in isolation
```

## 9. SRS / report notes
- Trust-and-safety diagram for the report: alert → queue (sorted) → ack
  (driver) → resolve (admin, receipted) with escalation severities; suspension
  → instant token death as the enforcement arrow.
- Viva line: "the last-admin guard means the platform is operable-under-mistake
  — including mistakes by operators" — self-lockout protection is the kind of
  boring reliability examiners love.
- Honest limitation: no bulk actions and no audit log beyond `resolved_by`/
  `suspended_at`; the car queue reuses the Module 5 routes rather than owning
  its own (deliberate — one verification path, one rule set).
