# VoltRide — Intelligent Private Vehicle Sharing
### AI-Based Route-Aware Matching and Minimum-Detour Pickup Optimization

---

## Table of contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech stack](#tech-stack)
4. [Directory structure](#directory-structure)
5. [Environment setup](#environment-setup)
6. [How to run locally](#how-to-run-locally)
7. [API reference](#api-reference)
8. [Frontend routes & components](#frontend-routes--components)
9. [Design system (Tailwind)](#design-system-tailwind)
10. [Testing](#testing)
11. [25-module roadmap](#25-module-roadmap)
12. [Deployment](#deployment)
13. [Common errors & fixes](#common-errors--fixes)
14. [Contributing & commit conventions](#contributing--commit-conventions)

> **Note:** `frontend/README.md` documents a separate *static HTML/CSS port* of the VoltRide design (no React, no Next.js, no build step). This file documents the real, framework-based codebase — the Next.js frontend + FastAPI backend monorepo.

---

## Overview

VoltRide matches riders to drivers heading the same way. Core product logic:

- **Route-aware matching** — pair riders/drivers on shared corridors, not just nearby points.
- **Minimum-detour pickup** — choose the pickup point that adds the least extra distance for the driver.
- **Fair cost splitting** — price each share by fuel/mileage and a configurable cost policy.
- **Live tracking** — follow the ride in real time with ETA.
- **Safety monitoring** — watch for safety events while the ride is in progress.
- **Driver/passenger roles** — separate consoles for publishing trips, booking, rating, and vehicle management.

---

## Architecture

```
┌─────────────┐      HTTP /api/v1      ┌──────────────────┐      MongoDB      ┌──────────────┐
│  Next.js    │ ◄─────────────────────► │   FastAPI        │ ◄───────────────► │  Motor ODM │
│  (frontend) │     Port 3000           │  (backend)       │   Port 27017      │  (driver)  │
│  Tailwind   │                         │  Port 8000       │                   │            │
│  TypeScript │                         │  Python          │                   │            │
└─────────────┘                         └──────────────────┘                   └──────────────┘
        │                                               │
        │                                               ▼
        │                                      OSRM / Nominatim
        │                              (routing + geocoding, Module 7)
        ▼
   framer-motion, lucide-react
```

Monorepo layout (each folder maps 1:1 to the 25 modules in `docs/`):

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Next.js (App Router) | 14.2.13 |
| UI library | React | 18.3.1 |
| Language | TypeScript | 5.6.2 |
| Styling | Tailwind CSS | 3.4.13 |
| Animations | framer-motion | 14.7.1 |
| Icons | lucide-react | 1.57.0 |
| Utility | clsx, tailwind-merge | 2.1.1 / 3.7.0 |
| Backend framework | FastAPI | 0.109–0.125 |
| Backend language | Python | 3.8 / 3.11+ |
| ASGI server | uvicorn | 0.25–0.34 |
| Settings / validation | pydantic, pydantic-settings | 2.6+ / 2.2+ |
| Database | MongoDB (Motor async driver) | 3.3+ |
| Auth | python-jose, passlib[bcrypt] | 3.3.0 / 1.7.4 |
| HTTP client | httpx | 0.26–0.29 |
| Testing | pytest, pytest-asyncio | 7.4.4 / 0.21.1 |

## Directory structure

```
carpooling/                         # monorepo root
├── README.md                       # this file
├── .env.example                    # full env contract (copy to .env)
├── start-dev.bat / start-dev.ps1   # one-command dev launcher (Windows)
├── docker-compose.yml              # mongo + backend + frontend dev wiring
│
├── frontend/                       # Next.js 14 App Router
│   ├── app/
│   │   ├── layout.tsx              # root layout, imports ./globals.css
│   │   ├── globals.css             # Tailwind directives + design tokens
│   │   ├── page.tsx                # landing page (/)
│   │   ├── analytics/...           # /analytics
│   │   ├── admin/...               # /admin
│   │   ├── database/...            # /database
│   │   ├── driver/...              # /driver
│   │   ├── garage/...              # /garage
│   │   ├── login/...               # /login
│   │   ├── me/...                  # /me
│   │   ├── passenger/...           # /passenger
│   │   ├── register/...            # /register
│   │   ├── requests/...            # /requests
│   │   ├── search/...              # /search
│   │   ├── trips/...               # /trips
│   │   └── verify/...              # /verify
│   ├── components/
│   │   ├── ui/                     # Button, Card, Input, Badge, Avatar, Separator, …
│   │   ├── NavBar.tsx, PageShell.tsx, BrandMark.tsx, RequireAuth.tsx, …
│   │   └── admin/, analytics/, database/, driver/, garage/, login/, me/,
│   │       passenger/, register/, requests/, search/, trips/, verify/
│   ├── lib/
│   │   ├── api.ts, http.ts, auth.ts, bookings.ts, cost.ts, geo.ts, …
│   │   └── utils.ts                # cn() helper (clsx + tailwind-merge)
│   ├── tailwind.config.ts          # Tailwind theme + content paths
│   ├── postcss.config.js
│   ├── next.config.js
│   ├── tsconfig.json               # paths: @/* -> ./*
│   ├── .env.local                  # frontend env (copy from .env.example)
│   └── package.json                # dev / build / start / lint / typecheck
│
├── backend/                        # FastAPI
│   ├── app/
│   │   ├── main.py                 # FastAPI entrypoint, CORS, mounts v1 router
│   │   ├── api/v1/                 # versioned route modules (22 routers)
│   │   │   ├── health.py           # /health, /ready, /version
│   │   │   ├── auth.py             # auth (Module 3)
│   │   │   ├── trips.py, bookings.py, search.py, geo.py, pickup.py, …
│   │   │   ├── cost.py, segments.py, rank.py, ratings.py, …
│   │   │   ├── notifications.py, analytics.py, tracking.py, safety.py, …
│   │   │   ├── live.py             # /stream (Module 20 WebSocket)
│   │   │   ├── admin.py, recurring.py, vehicles.py, profile.py, …
│   │   │   ├── db_admin.py, fuel.py
│   │   │   └── router.py           # single aggregation point
│   │   ├── core/
│   │   │   ├── config.py           # single env source of truth (get_settings)
│   │   │   ├── database.py         # Motor client + ping_db()
│   │   │   ├── deps.py, security.py, indexes.py
│   │   │   └── models/
│   │   └── services/
│   ├── tests/                      # one test file per module (25 files)
│   ├── conftest.py
│   ├── pytest.ini                  # asyncio_mode = strict
│   ├── requirements.txt
│   ├── .env                        # backend env (copy from .env.example)
│   └── .env.example
│
├── database/
│   ├── schemas/                    # per-collection shapes (users, vehicles, trips, …)
│   ├── indexes/                    # mongosh/js index scripts incl. 2dsphere
│   └── seed/                       # dev seed scripts (never production data)
│
├── ml/                             # ML ranking / cost models (Module 16)
│
└── docs/

## Environment setup

1. Copy the root env template:
   ```powershell
   copy .env.example .env
   ```
2. Copy the backend env template:
   ```powershell
   copy backend\.env.example backend\.env
   ```
3. Copy the frontend env template:
   ```powershell
   copy frontend\.env.example frontend\.env.local
   ```
4. Edit values as needed (never commit real secrets).

### Full variable contract

| Variable | Default | Description |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGO_DB` | `vehicle_sharing_dev` | Database name |
| `BACKEND_PORT` | `8000` | Backend port |
| `JWT_SECRET` | `change-me-in-dev-only-min-32-chars` | JWT signing secret (change in prod) |
| `JWT_EXPIRE_MINUTES` | `10080` | Token lifetime (7 days) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed frontend origins |
| `APP_ENV` | `development` | `development` or `production` (Module 25 guard) |
| `GIT_SHA` | `dev` | Build metadata baked in by Dockerfile |
| `ROUTING_PROVIDER` | `osrm` | Routing provider switch (Module 7) |
| `GEOCODER_PROVIDER` | `nominatim` | Geocoding provider |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` | Frontend-facing API base |
| `NEXT_PUBLIC_MAP_STYLE` | `dark` | Map theme |
| `NEXT_PUBLIC_OSRM_URL` | `https://router.project-osrm.org` | OSRM demo endpoint |
| `NEXT_PUBLIC_NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Nominatim endpoint |
| `FUEL_PRICE_PETROL/DIESEL/CNG/EV/HYBRID` | `104.5 / 95.0 / 89.0 / 12.0 / 95.0` | Per-unit fuel prices in INR (Module 12) |
| `DEFAULT_MILEAGE_KMPL` | `15.0` | Default vehicle mileage |
| `DEFAULT_COST_POLICY` | `split_equal` | Default cost-split policy |

## How to run locally

### Option 1 — one-command dev launcher (recommended, Windows)

Open PowerShell in the repo root:

```powershell
# Both backend (:8000) and frontend (:3000) in separate windows
.\start-dev.ps1

# Backend only
.\start-dev.ps1 -BackendOnly

# Frontend only
.\start-dev.ps1 -FrontendOnly

# Hidden scheduled-task mode (logs to backend\run.log / frontend\dev.log)
.\start-dev.ps1 -Auto
```

`start-dev.ps1` also nudges the MongoDB Windows service if it is stopped, and bypasses the PowerShell execution policy per-process (needed because `npm.ps1` is blocked by machine policy).

Open:
- Frontend: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/v1/health`

### Option 2 — manual, backend only

```powershell

## API reference

All backend routes are versioned under `/api/v1` and aggregated in `backend/app/api/v1/router.py`.

### Core probes

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service metadata (`service`, `docs`, `health`) |
| `GET` | `/api/v1/health` | Liveness — always 200 while up, even if Mongo is down |
| `GET` | `/api/v1/ready` | Readiness — 200 only when Mongo answers; use for load-balancer probes |
| `GET` | `/api/v1/version` | Build metadata (`GIT_SHA`, `APP_ENV`, Python version) |

### Versioned route modules (`/api/v1/*`)

| Module | Router | Domain |
|---|---|---|
| auth | `auth.py` | Authentication / sessions (Module 3) |
| profile | `profile.py` | User profiles (Module 4) |
| vehicles | `vehicles.py` | Driver vehicle management (Module 5) |
| trips | `trips.py` | Trip lifecycle (Module 6) |
| geo | `geo.py` (+ `_trips`) | Routing / geocoding (Module 7) |
| search | `search.py` | Ride search (Module 8) |
| pickup | `pickup.py` | Minimum-detour pickup optimization (Module 10) |
| bookings | `bookings.py` | Booking requests (Module 11) |
| cost | `cost.py` | Fuel / mileage cost engine (Module 12) |
| segments | `segments.py` | Route segments (Module 13) |
| advance-booking | (bookings) | Advance booking limits (Module 14) |
| recurring | `recurring.py` | Recurring trip series (Module 15) |
| rank | `rank.py` | ML match ranking (Module 16) |
| ratings | `ratings.py` | Driver / ride ratings (Module 22) |
| notifications | `notifications.py` | Notifications (Module 23) |
| analytics | `analytics.py` | Impact dashboard (Module 24) |
| tracking | `tracking.py` | Live ride tracking (Module 17) |
| safety | `safety.py` | Safety events (Module 18) |
| live | `live.py` | WebSocket stream `/stream` (Module 20) |
| admin | `admin.py` | Admin panel (Module 21) |

## Frontend routes & components

### App Router pages (`frontend/app/`)

| Route | Page | Purpose |
|---|---|---|
| `/` | `page.tsx` | Landing page (hero, vehicle art, live corridor, features, roles) |
| `/search` | `search/page.tsx` | Ride search form (from/to, date, time, seats) |
| `/trips` | `trips/page.tsx` | Driver console (publish panel, upcoming trips, live track) |
| `/requests` | `requests/page.tsx` | Booking requests |
| `/analytics` | `analytics/page.tsx` | Impact dashboard |
| `/garage` | `garage/page.tsx` | Driver vehicle management |
| `/me` | `me/page.tsx` | Profile page |
| `/login` | `login/page.tsx` | Sign in |
| `/register` | `register/page.tsx` | Sign up |
| `/verify` | `verify/page.tsx` | Email/phone verification |
| `/admin` | `admin/page.tsx` | Admin panel |
| `/database` | `database/page.tsx` | Database admin view |
| `/driver` | `driver/page.tsx` | Driver shell |
| `/passenger` | `passenger/page.tsx` | Passenger shell |

### Shared layout & components

- `layout.tsx` — root layout; imports `./globals.css`
- `globals.css` — Tailwind `@tailwind` directives + design tokens + `@layer` blocks
- `components/NavBar.tsx` — top navigation with `BrandMark`
- `components/PageShell.tsx` — reusable page container (`panel-head` variant)

## Design system (Tailwind)

### Config (`frontend/tailwind.config.ts`)

- `darkMode`: `["selector", '[data-theme="dark"]']`
- `content`: `./app/**`, `./components/**`, `./lib/**` (`.js,.ts,.jsx,.tsx,.mdx`)
- `theme.extend.colors` uses the project's `rgb(var(--color-...))` convention, keyed to CSS custom properties in `globals.css`.
- Custom colors: `accent`, `brand` (DEFAULT/teal/accent), `ink`, `muted`, `line`, `surface`, `bg`, `card`, `success`, `warn`, `danger`, `iris`, `volt`, `rose`, `amber`, `orange`.
- `borderRadius`: `lg`, `md`, `sm` (based on `--radius`).
- `boxShadow`: `glow`, `glow-brand`.

### Tokens (`frontend/app/globals.css`)

Defined in `:root` (dark) and `[data-theme="light"]`, referenced via `rgb(var(--color-*))`:

| Category | Variables |
|---|---|
| Backgrounds | `--color-bg`, `--color-bg-glow`, `--color-surface`, `--color-card`, `--color-card-hover` |
| Brand | `--color-brand`, `--color-brand-teal`, `--color-brand-amber`, `--color-on-brand*`, `--color-accent` |
| Text | `--color-ink`, `--color-ink-soft`, `--color-muted` |
| Borders | `--color-line`, `--color-line-hover` |
| Status | `--color-success`, `--color-warn`, `--color-danger` |
| Glass | `--glass-bg`, `--glass-border`, `--glass-border-hover`, `--glass-shadow` |
| Shadows | `--shadow-xs`…`--shadow-lg`, `--shadow-glow-brand`, `--shadow-glow-teal` |
| Radius | `--radius-sm`…`--radius-full` |
| Spacing | `--space-1`…`--space-16` |

### `@layer` structure

- `@tailwind base` / `@tailwind components` / `@tailwind utilities` — at the top of `globals.css` (lines 1–3).
- `@layer base` — reset, `body`, typography, focus styles.
- `@layer utilities` — keyframes, animations, gradients, glass utilities.
- `@layer components` — `.btn`, `.card`, `.panel`, `.badge`, `.pill`, `.alert`, `.toast`, `.table`, `.nav-link`, `.link-volt`, `.skip-link`, and token helper classes (`.bg-token-*`, `.text-token-*`, `.border-token-line`).

### Hover color tokens (added to fix `@apply` resolution)

`card` and `line` were plain strings (only `DEFAULT`), so `bg-card-hover` / `border-line-hover` did not resolve in `@apply`. They are now nested:

```ts
line: {
  DEFAULT: "rgb(var(--color-line))",
  hover: "rgb(var(--color-line-hover))",
},
card: {
  DEFAULT: "rgb(var(--color-card))",
  hover: "rgb(var(--color-card-hover))",
},
```

## Testing

### Backend

```powershell
cd backend
python -m pytest -q
```

- 25 test files, one per module (`tests/test_<module>.py`)
- `pytest.ini`: `asyncio_mode = strict`, `testpaths = tests`
- `conftest.py` shares fixtures
- `test_health.py` are smoke tests that do not need MongoDB

### Frontend

```powershell
cd frontend
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run build       # next build (production compile)
```

## 25-module roadmap

| # | Module | Area | Notes |
|---|---|---|---|
| 1 | setup | Scaffolding | Monorepo, env contract, health API, frontend shell |
| 2 | db-design | Database | MongoDB schemas, indexes, seed scripts |
| 3 | auth | Auth | Sessions, JWT, password hashing |
| 4 | profile | Profiles | User profile CRUD |
| 5 | vehicles | Vehicles | Driver vehicle registry |
| 6 | trips | Trips | Trip lifecycle |
| 7 | maps | Maps / routing | OSRM + Nominatim integration |
| 8 | search | Search | Ride search form + results |
| 9 | matching | Matching | Route-aware rider/driver pairing |
| 10 | pickup-optimization | Pickup | Minimum-detour pickup point |
| 11 | bookings | Bookings | Booking requests |
| 12 | cost | Cost | Fuel/mileage cost engine |
| 13 | segments | Segments | Route segments |
| 14 | advance-booking | Bookings | Advance booking limits |
| 15 | recurring | Bookings | Recurring trip series |
| 16 | ai-ranking | ML | Match ranking model |
| 17 | tracking | Tracking | Live ride tracking |
| 18 | safety | Safety | Safety event monitoring |

| 19 | completion | Trips | Trip completion flow |
| 20 | streaming | Live | WebSocket `/stream` |
| 21 | admin | Admin | Admin panel |
| 22 | ratings | Ratings | Driver/ride ratings |
| 23 | notifications | Notifications | Notification service |
| 24 | analytics | Analytics | Impact dashboard |
| 25 | deploy | Deploy | Production startup guard, Docker |

See `docs/module-XX-*.md` for the 9-part note per module (concept, prerequisites, rules, code map, integration, run+test, common errors, commit message, SRS/report notes).
## Deployment

- **Docker / compose**: `docker-compose.yml` wires MongoDB + backend + frontend (see also `docker-compose.prod.yml` for Mongo credentials).
- **Production startup guard (Module 25)**: when `APP_ENV=production`, the backend refuses to boot if:
  - `JWT_SECRET` is still the shipped development value or shorter than 32 chars, or
  - `CORS_ORIGINS` is empty, or contains a plain-http origin outside localhost, or
  - `MONGO_DB` is empty.
- **Readiness probe**: `GET /api/v1/ready` returns 503 when Mongo is unreachable — this is what a load balancer or Docker healthcheck should poll.
- **Build metadata**: `GET /api/v1/version` reports `GIT_SHA` (baked in by the Dockerfile).

## Common errors & fixes

| Error | Cause → fix |
|---|---|
| `npm.ps1 cannot be loaded` | PowerShell execution policy blocks `npm`. Use `npm.cmd`, or run with `-ExecutionPolicy Bypass` (start-dev.ps1 does this per-process). |
| `TypeError: 'type' object is not subscriptable` | `list[str]` syntax on Python 3.8. Keep the range pins in `requirements.txt`; `config.py` already uses `typing.List`. |
| Health reports `db: disconnected` | MongoDB not running. Expected until Module 2 starts it; start the `MongoDB` Windows service or run `mongod`. |
| Tailwind: `The hover:bg-card-hover class does not exist` | `card`/`line` were plain-string theme tokens (no `hover`). Fixed by nesting them with `DEFAULT`/`hover` in `tailwind.config.ts`; CSS variables already existed in `globals.css`. |
| Webpack `.next/cache … ENOENT ... 5.pack.gz` | Stale `.next` cache. Delete `frontend/.next` and rebuild (`npm run build` or `npm run dev`). |
| `BrandMark is not defined` | `BrandMark` is a named export from `@/components/BrandMark`; ensure the page imports it before use. |

## Contributing & commit conventions

Commit messages follow the style used in the module notes:

```
<type>(<scope>): <short summary>

- backend: …
- frontend: …
- tooling: …
```

Examples from the project:

```
chore(setup): scaffold monorepo, backend health API, Direction-B frontend shell
feat(auth): add login + register routes with JWT session
fix(ui): nest card/line Tailwind tokens so hover variants resolve in @apply
```

- Run `npm run typecheck` and `python -m pytest -q` before opening a pull request.
- Never commit real secrets; use `.env.example` / `.env.local` templates only.


---

**License:** Private project — see repository for distribution terms.
---

**License:** Private project — see repository for distribution terms.
```
chore(setup): scaffold monorepo, backend health API, Direction-B frontend shell
feat(auth): add login + register routes with JWT session
fix(ui): nest card/line Tailwind tokens so hover variants resolve in @apply
```

- Run `npm run typecheck` and `python -m pytest -q` before opening a pull request.
- Never commit real secrets; use `.env.example` / `.env.local` templates only.

---

**License:** Private project — see repository for distribution terms.

## Contributing & commit conventions

Commit messages follow the style used in the module notes:

```
<type>(<scope>): <short summary>

- backend: …
- frontend: …
- tooling: …
```

Examples from the project:

```
chore(setup): scaffold monorepo, backend health API, Direction-B frontend shell
feat(auth): add login + register routes with JWT session
fix(ui): nest card/line Tailwind tokens so hover variants resolve in @apply
```

- Run `npm run typecheck` and `python -m pytest -q` before opening a pull request.
- Never commit real secrets; use `.env.example` / `.env.local` templates only.

---

**License:** Private project — see repository for distribution terms.

The matching CSS variables already existed in both light and dark themes, so no new variables were required. This enables classes like `hover:bg-card-hover` and `hover:border-line-hover` used in `.card-hover`, `.panel-hover`, and `Button.tsx` / `Card.tsx`.

### Theme toggle

Dark/light is toggled via `data-theme` on `<html>` (default dark). Respects `prefers-reduced-motion`.
- `components/BrandMark.tsx` — inline SVG logo (named export `BrandMark`)
- `components/RequireAuth.tsx` — auth guard wrapper
- `components/SessionProvider.tsx` — session context
- `components/SiteFooter.tsx` — site footer
- `components/ui/` — primitive UI kit: `Button`, `Card`, `Input`, `Badge`, `Avatar`, `Separator`, `TripCard`, `RideCard`, `MatchCard`, `StatusPill`, `ThemeToggle`, `LiveTrack`, `RouteMap`, `PickerMap`, `PlacePicker`, `PickupChooser`, `StarPicker`, `Stars`, `CollectionCard`, `FeatureGrid`, `LiveCorridorMap`, `SafetyBanner`, `SegmentView`, `RateRideCard`, `TripCostCard`, `TrustSignals`, `VehicleArt`, `VehicleCard`, `VehicleForm`, `BookingPanel`, `MatchPipeline`, `NotificationBell`
| completion | (trips) | Trip completion (Module 19) |
| deploy | (main.py) | Production startup guard (Module 25) |
| db_admin | `db_admin.py` | Database administration |
| fuel | `fuel.py` | Fuel price reference |
| health | `health.py` | Health / ready / version probes |

Frontend consumes these via `frontend/lib/api.ts` and per-domain modules (`auth.ts`, `trips.ts`, `bookings.ts`, `search.ts`, `analytics.ts`, …), with `http.ts` as the shared fetch wrapper.
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

Expect `GET /api/v1/health` → `{"status":"ok","service":"Intelligent Vehicle Sharing API","db":"disconnected","routing_provider":"osrm"}` (`db` is `disconnected` until MongoDB runs).

### Option 3 — manual, frontend only

```powershell
cd frontend
npm install
npm run dev
```

Then visit `http://localhost:3000`. Use `npm run build` for a production build and `npm run start` to serve it.
| `ADVANCE_MAX_DAYS` | `30` | Max days ahead a booking may be made (Module 14) |
| `ADVANCE_MIN_NOTICE_MIN` | `60` | Minimum notice before departure (Module 14) |
| `RECURRING_HORIZON_DAYS` | `21` | Days of recurring instances materialised (Module 15) |
| `RECURRING_MAX_DAYS` | `90` | Hard ceiling for a recurring series (Module 15) |
    ├── README.md                   # module-note index + 9-part template
    └── module-01-setup.md … module-25-deploy.md
```
| Folder | Purpose |
|---|---|
| `frontend/` | Next.js 14 App Router (React 18, TypeScript, Tailwind CSS) |
| `backend/` | FastAPI (Python), versioned `/api/v1` router, Motor MongoDB client |
| `database/` | MongoDB collection schemas, index scripts (incl. 2dsphere), seed scripts |
| `ml/` | ML ranking / cost models (Module 16) |
| `docs/` | One note per module (9-part template feeding the SRS / final report) |

Environment contract is defined first (`.env.example` at root + per-service), so secrets are never committed.
Status: **25 / 25 modules complete · 121 tests passing · 92 API routes · 11 collections**

A private-vehicle sharing platform that matches riders to drivers travelling the
same corridor, picks the pickup point that costs the driver the least extra
distance, prices the share fairly, then tracks the ride and watches for safety
events while it happens.
