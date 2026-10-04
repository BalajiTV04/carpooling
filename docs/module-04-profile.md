# Module 4 — User profile management
**Status:** VERIFIED · `pytest` 15/15 (incl. profile flow) · single-file `db_admin` fix NOT needed — new `profile.py` router registered.

## 1. Concept / why
Auth (Module 3) proves WHO you are; profile is what others SEE. Split into
full (`GET/PATCH /users/me` — private fields like email) vs public
(`GET /users/{id}` — name/roles/rating/verified only, phone/email/hash never
leak). Phone is immutable (it's the login key); email is optional+unique;
avatar is URL-only (no file upload — keeps the MCA scope sane, hot-link any
https image). Role upgrade (`POST /users/me/roles`) lets a passenger become a
driver without re-registering, but the driver role needs a verified phone
(safety: riders must reach the driver on trip day).

## 2. Prerequisites
- Modules 1–3 (session, `get_current_user`) · Mongo running
- No DB migration — reuses `users`; no new indexes (email uses Module 2's
  sparse unique index)

## 3. DB changes + endpoints
No schema change. Endpoints: `GET /users/me` · `PATCH /users/me`
(name/email/avatar; empty patch→422, bad email/avatar→422, email clash→409) ·
`POST /users/me/roles {driver|passenger}` (unverified→driver = 403,
duplicate = 409) · `POST /users/me/password` (wrong current = 401) ·
`GET /users/{id}` (login required; 404 on bad id/suspended).

## 4. Code map
- `models/profile.py` — ProfileOut / PublicProfileOut / UpdateProfileIn
  (email lowercased, "" clears; avatar must be http(s), "" clears) / AddRoleIn
  (driver|passenger only — admin never self-added) / ChangePasswordIn.
- `api/v1/profile.py` — 5 routes; `find_one_and_update(return_document=True)`
  so responses reflect the write; DuplicateKey→409 on email.
- `router.py` — one added line (include profile).
- `tests/test_profile.py` — live flow: view→edit→validation 422s→email
  clash 409→public card privacy→guest 401→role gate 403→OTP→role OK→password
  rotation (fixed numbers +919000000401/402, cleaned after).
- Frontend: `lib/profile.ts` typed client · `components/Stars.tsx` ·
  `/me` rebuilt: identity card + edit form + driver-upgrade panel + password +
  public preview + logout.
- Infra fix (worth reporting): Motor client pinned to first event loop broke
  later tests ("Event loop is closed") — `core/database.py` now tracks the
  owning loop, rebuilds on rotation, `ping_db` retries once. This also
  hardens `uvicorn --reload` reconnects.

## 5. Integration
Unchanged auth/session; `/me` now reads full profile via `profileApi.mine()`
then syncs session. Module 5 (vehicles) will check `driver` role + verified
phone using this profile; Module 6 checks the same before publishing.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 15 passed, 0 skipped
# Manual: login → GET /users/me → PATCH name/email → POST /users/me/roles driver
# → GET /users/<id> as another user (no phone/email in JSON)
```
Frontend: `/me` → edit name/email/avatar → Save ✓ → Become-a-driver →
password change → public preview shows stars without phone.

## 7. Common errors
| Error | Fix |
|---|---|
| 422 nothing to update | PATCH needs ≥1 of full_name/email/avatar_url |
| 409 email in use | sparse unique index — each email once; blank clears yours |
| 403 become-driver | verify phone first (`/verify`) |
| Event loop is closed (tests) | fixed via loop-tracking client (see §4) |
| avatar not showing | must start http(s):// — plain paths rejected by design |

## 8. Commit message
```
feat(profile): view/edit, public card, role upgrade, password change

- /users/me GET+PATCH, /users/{id} public, /me/roles + /me/password
- validation (email/avatar/empty-patch), 409/403/401 semantics, tests green 15/15
- frontend /me rebuilt with Stars + upgrade + preview
- fix: loop-aware Motor client (kills 'Event loop is closed' in tests/reload)
```

## 9. SRS / report notes
- Profile privacy table: full vs public fields (state phone/email/hash NEVER public).
- State machine: passenger --(verified phone)--> driver; role removal = admin-only (Module 21).
- Report the Motor loop fix as an implementation challenge + solution (examiners
  reward real debugging stories with root cause → fix → verification).
