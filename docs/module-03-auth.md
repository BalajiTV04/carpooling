# Module 3 — Authentication
**Status:** VERIFIED · `pytest` 14/14 (4 crypto units + full register→login→OTP→/me flow live) · `init_db` ensures 21 indexes incl. `phone_otps`.

## 1. Concept / why
Phone number is the identity (E.164 `users.phone`, unique). Password proves
ownership; 6-digit OTP proves the SIM belongs to you — drivers must be
verified before publishing trips (Module 6 enforces). JWT (stateless) keeps
the API horizontally scalable: no server sessions, every request carries
`{sub, phone, roles, exp}`. Roles gate routes: `require_roles("driver")`
wraps trip publishing, `"admin"` wraps the dashboard. `get_current_user`
re-reads `status` per request → suspending a user revokes access instantly
(safety-first principle).

## 2. Prerequisites
- Modules 1–2 (Motor client, users validator) · Mongo running · `init_db.py`
- New dep: none — `python-jose` + `passlib` were already in requirements
- Passwords use PBKDF2-SHA256 (pure-python, Py3.8-safe); swap one line to bcrypt later

## 3. DB changes + endpoints
New: `phone_otps {phone, code, expires_at, attempts, created_at}` + TTL
(`expires_at`, 0s) + `ix_otps_phone`. Mirrored in `indexes.py`, validator in
`database/schemas/phone_otps.json`, mongosh in `indexes/02-auth.mongosh.js`.
Endpoints: `POST /auth/register→201+JWT` · `POST /auth/login` · `POST
/auth/otp/request` (dev_code echoed — NO paid SMS in project) · `POST
/auth/otp/verify` (single-use, 5-try lock, 10-min expiry) · `GET /auth/me` ·
`POST /auth/logout` (stateless note).

## 4. Code map
- `core/security.py` — hash/verify (PBKDF2), JWT create/decode, OTP gen/expiry.
- `core/deps.py` — `get_current_user` (JWT→live user, rejects suspended),
  `require_roles(*roles)` gate, `get_optional_user` (personalised public search later).
- `models/auth.py` — Register/Login/OTP shapes; RegisterIn REJECTS `admin`
  self-registration (422) — admins are seeded/promoted only.
- `api/v1/auth.py` — the 6 routes; OTP verify deletes code BEFORE flipping
  `phone_verified` (no replay); DuplicateKey→409.
- `tests/test_auth.py` — 4 offline units + live end-to-end (fixed number
  +919000000301, cleaned before/after).
- Frontend: `lib/auth.ts` (typed client + localStorage session) ·
  `components/SessionProvider.tsx` (login state) · `RequireAuth.tsx` (guard +
  role 403 card) · `AuthShell.tsx` (form skin) · `app/{register,login,verify,me}`
  pages · `NavBar` in layout (Join vs profile links).

## 5. Integration
One line in `router.py` (include auth). `/me` proves session; Module 4 adds
profile editing on the same session; Module 6 gates publishing with
`require_roles("driver")` + `phone_verified`.

## 6. Run + test (verified just now)
```powershell
cd backend
python init_db.py          # expect: validated ×8, indexes ensured: 21
python -m pytest -q        # expect: 14 passed
# Manual: POST /api/v1/auth/register {"phone":"+919876543299","password":"pass1234","full_name":"Demo","roles":["passenger"]}
# → 201 + access_token; POST /auth/otp/request → dev_code; POST /auth/otp/verify → phone_verified True
```
Frontend: `/register` → `/verify?fresh=1` (code shown on screen) → `/me`
✓ pill; `/me` without login → `/login?next=/me`.

## 7. Common errors
| Error | Fix |
|---|---|
| 409 phone exists | expected — login instead; seed number +919876543210 already in DB |
| 422 roles admin | by design — request driver/passenger only |
| 401 wrong code / 429 locked / 410 expired | request fresh code; 5 tries max; 10-min TTL |
| 401 on /me | missing `Authorization: Bearer <token>` |
| `SyntaxError typing import` | Py3.8 needs `from typing import …` (fixed in deps.py) |
| localStorage token XSS | demo-acceptable; hardening = HttpOnly cookies + short expiry + refresh rotation (viva line) |

## 8. Commit message
```
feat(auth): JWT + password + dev-OTP phone verification + roles

- security/deps/auth routes, phone_otps TTL collection, role gates
- tests: 4 crypto units + live register/login/OTP/me flow (14/14 green)
- frontend: session provider, guards, register/login/verify/me, navbar
```

## 9. SRS / report notes
- Auth flow diagram: register → OTP request → verify → JWT → role-gated routes.
- Decisions for viva: phone-as-identity (drivers reachable on trip day);
  stateless JWT (scales); PBKDF2 now/bcrypt later; dev-OTP transport stubbed,
  verification logic production-shaped; per-request status check = instant suspend.
- Security table: hash, unique phone, single-use expiring OTP, attempt lock,
  no admin self-registration, suspended→403 immediately.
