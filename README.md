# VoltRide — Intelligent Private Vehicle Sharing

### AI-Based Route-Aware Matching and Minimum-Detour Pickup Optimization

![Python](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109%2B-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14.2-white?logo=next.js&logoColor=black)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-3.3%2B-47A248?logo=mongodb&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-147%20passing-brightgreen?logo=jest)
![License](https://img.shields.io/badge/License-Private-lightgrey)

---

## Table of contents

1. [Overview](#overview)
2. [Quick Start (5 minutes, no Docker)](#quick-start-5-minutes-no-docker)
3. [Architecture](#architecture)
4. [Tech stack](#tech-stack)
5. [Database schema (11 MongoDB collections)](#database-schema-11-mongodb-collections)
6. [Directory structure](#directory-structure)
7. [Environment setup](#environment-setup)
8. [How to run locally](#how-to-run-locally)
9. [API reference](#api-reference)
10. [Minimum-detour search](#minimum-detour-search)
11. [Frontend routes & components](#frontend-routes--components)
12. [Design system (Tailwind)](#design-system-tailwind)
13. [Testing](#testing)
14. [25-module roadmap](#25-module-roadmap)
15. [Deployment](#deployment)
16. [Common errors & fixes](#common-errors--fixes)
17. [Contributing & commit conventions](#contributing--commit-conventions)

> **Note:** This file documents the real, framework-based codebase — the Next.js frontend + FastAPI backend monorepo. The `frontend/README.md` documents a separate static HTML/CSS port (no React, no Next.js, no build step).

## Overview

VoltRide matches riders to drivers heading the same way, optimizing for corridor sharing, minimum detour, fair cost splitting, live tracking, and safety monitoring.

### Core product logic

- **Route-aware matching & multi-route selection (Module 26)** — pair riders/drivers on shared corridors, not just nearby points. Drivers choose from multiple OSRM driving paths (Fastest Primary Route vs. Alternatives via bypass/arterial corridors) with accurate distance, duration, and geometry preview before staging/hosting as a draft.
- **Minimum-detour pickup** — choose the pickup point that adds the least extra distance for the driver. The matching engine evaluates candidate pickup points along the driver's routed path and selects the one minimizing total detour via `POST /api/v1/rides/search-with-detour` (Module 10).
- **Transparent fuel & other expenses calculator** — computes fair fuel costs dynamically:
  $$\text{Fuel Cost} = \left(\frac{\text{Distance}}{\text{Mileage}}\right) \times \text{Fuel Price}$$
  $$\text{Total Required Amount} = \text{Fuel Cost} + \text{Other Expenses (Tolls, Parking, Permits)}$$
  $$\text{Per Seat Price} = \frac{\text{Total Required Amount}}{\text{Available Seats}}$$
  Itemized expenses (`+ Add Expense`) allow adding toll charges, parking fees, or interstate permits directly into the shared trip pool.
- **Dynamic split-equal cost sharing & fare reduction history** — as passengers join or leave a shared corridor, the cost-sharing engine re-splits segments equally across all occupants (driver + passengers). Passengers view their previous fare crossed out (`~~₹1,250~~`), present reduced fare (`₹834`), and a celebration savings badge (`Saved ₹416!`).
- **Live GPS location picking** — 1-tap quick buttons (`📍 Live GPS Source`, `📍 Live GPS Destination`) with reverse geocoding via OpenStreetMap/Nominatim to instantly set current device coordinates.
- **"Seat Over (Sold Out)" trip status** — when all seats are booked (`seats_left <= 0`), the trip remains visible in passenger search results with a distinct badge and disabled booking action rather than disappearing.
- **Flexible cancellation policy** — passengers can cancel bookings (`requested`, `accepted`, or `confirmed`) up until trip departure/completion. Cancellations immediately restore seat availability and re-split remaining occupant fares.
- **Trip completion & driver ratings** — drivers mark destination reached with `Complete Trip ✓`, which notifies passengers and surfaces a 1–5 star rating & feedback card. Ratings instantly synchronize to the driver's public profile and admin console.
- **Live tracking & safety monitoring** — real-time vehicle GPS ping broadcasting, active route polyline tracking, and instant SOS alerts.
- **Driver, passenger & admin workspaces** — purpose-built consoles for drivers (hosting live, monthly, or long trips with mileage/fuel calculators), passengers (search, book, track, cancel, rate), and admins (system-wide moderation, trip approvals, user management).

---

## Quick Start (5 minutes, no Docker)

Want to run VoltRide locally without Docker? Follow these steps.

### Prerequisites

- **Python 3.8+** (backend) — `python --version`
- **Node.js 18+** (frontend) — `node --version`
- **MongoDB** — either a local MongoDB instance (`mongod`) or a MongoDB Atlas cloud cluster

### 1. Clone and configure

```powershell
# Clone the repo
git clone https://github.com/BalajiTV04/carpooling.git
cd carpooling

# Backend environment
cd backend
copy .env.example .env
# Edit .env: set MONGO_URI to your MongoDB connection string
# Edit .env: set JWT_SECRET to a 32+ character random string

# Frontend environment
cd ..\frontend
copy .env.example .env.local
# Edit .env.local: set NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 2. Initialize the database

```powershell
cd backend
python init_db.py       # creates collections, validators, and indexes
python seed.py          # optional: demo accounts + trip history
```

### 3. Start the backend

```powershell
cd backend
uvicorn app.main:app --reload --port 8000
```

Backend API is now at `http://localhost:8000` — try `http://localhost:8000/api/v1/health`.

### 4. Start the frontend

```powershell
cd ..\frontend
npm install
npm run dev             # http://localhost:3000
```

Open `http://localhost:3000` in your browser. Register as a driver or passenger, publish a trip, and search for matches.

### 5. Verify everything works

| Check | Command / URL | Expected |
|-------|--------------|----------|
| Backend health | `curl http://localhost:8000/api/v1/health` | `{"status":"ok", ...}` |
| Backend ready | `curl http://localhost:8000/api/v1/ready` | `{"ready":true}` (Mongo connected) |
| API docs | `http://localhost:8000/docs` | Swagger UI |
| Frontend | `http://localhost:3000` | Next.js app loads |

### Troubleshooting the quick start

| Problem | Fix |
|---------|-----|
| `uvicorn` not found | `pip install -r backend/requirements.txt` |
| `npm` not found | Install Node.js 18+ from https://nodejs.org |
| `health` says `disconnected` | MongoDB is not running — start `mongod` or check your Atlas URI |
| `409 phone exists` on register | That phone already has an account — log in instead |
| `npm.ps1 cannot be loaded` | Use `npm.cmd` or run PowerShell with `-ExecutionPolicy Bypass` |

---

### Key features by module

| Module | Title | Status |
|--------|-------|--------|
| 1 | Project setup | ✅ Verified |
| 2 | Database design | ✅ Verified live |
| 3 | Authentication | ✅ Verified |
| 4 | Profile | — |
| 5 | Vehicles | — |
| 6 | Trips | — |
| 7 | Map integration + routing service | ✅ Verified |
| 8 | Search | — |
| 9 | Route-aware matching engine | ✅ Verified |
| 10 | Pickup optimization (minimum-detour search) | ✅ Verified |
| 11 | Bookings | — |
| 12 | Cost | — |
| 13 | Segments | — |
| 14 | Advance booking | — |
| 15 | Recurring rides | — |
| 16 | AI ride ranking (learned re-rank) | ✅ Verified |
| 17 | Tracking | ✅ Verified |
| 18 | Safety | — |
| 19 | Completion | ✅ Verified |
| 20 | Streaming | — |
| 21 | Admin | ✅ Verified |
| 22 | Ratings | ✅ Verified |
| 23 | Notifications | — |
| 24 | Analytics | — |
| 25 | Deploy & harden | ✅ Verified |
| 26 | Driver-chosen route & multi-alternative selection | ✅ Verified |

## Architecture

```text
┌─────────────┐      HTTP /api/v1      ┌────────────────────┐      MongoDB      ┌──────────────┐
│  Next.js    │ ◄─────────────────────► │   FastAPI          │ ◄───────────────► │  Motor ODM   │
│  (frontend) │     Port 3000           │  (backend)         │   Port 8000       │  (driver)    │
│  Tailwind   │                         │  Python            │                   │              │
│  TypeScript │                         │  uvicorn           │                   │              │
└─────────────┘                         └────────────────────┘                   └──────────────┘
        │                                               │
        │                                               ▼
        │                                      OSRM / Nominatim
        │                              (routing + geocoding, Module 7)
        ▼
   framer-motion, lucide-react
```

### Data flow

1. **Trip creation**: Passenger searches for a route via PlacePicker → RouteMap (Module 7, OSRM/Nominatim) → trip is created with `route_geometry`, `distance_km`, `duration_min`.
2. **Matching**: Search service retrieves candidate trips → Matching engine projects passenger's pickup/dropoff onto the driver's route → computes overlap_pct, pickup_km, dropoff_km, forward direction → weighted score (45% overlap + 25% pickup + 15% dropoff + 15% time).
3. **Minimum-detour search**: `POST /api/v1/rides/search-with-detour` runs the 8-step detour optimiser over every published trip for the day — route snapping, corridor projection, direction & overlap gates, feasibility limits (max detour 3 km, extra time 10 min, max pickup 3 km) — and returns enriched matches with pickup/drop points, detour km, extra time, route overlap %, and estimated passenger contribution.
4. **AI re-ranking**: Only feasible candidates (gates enforced) are re-ranked by the AI model: `blended = 0.5 * rule + 0.5 * AI`. AI never overrides hard constraints (pickup distance, direction, overlap).
5. **Booking**: Accepted match snapshot is stored with `ai_score`, `ai_model` info. Booking creates a `match_explain` record for auditability.
6. **Tracking**: Live GPS tracking updates trip locations; geometry is compared against the routed path (Module 18, 19).
7. **Completion**: Ride completion is recorded with ratings and safety summary (Modules 19, 22).

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
| ML / ranking | scikit-learn, numpy, pandas, xgboost | 1.1.1 / 1.24.3 / 2.0.3 / 2.1.4 |

## Database schema (11 MongoDB collections)

Created and validated by `backend/init_db.py` (run once before first use). All indexes are ensured idempotently.

| Collection | Core fields | Indexes |
|------------|-------------|---------|
| `users` | `_id`, `phone` (E.164, unique), `password_hash`, `full_name`, `roles` `[passenger\|driver]`, `phone_verified`, `status`, `rating_avg`, `rating_count`, `created_at` | unique on `phone` |
| `vehicles` | `_id`, `user_id`, `plate` (unique), `make`, `model`, `color`, `fuel_type`, `mileage_kmpl`, `seating_capacity`, `verified`, `created_at` | unique on `plate` |
| `trips` | `_id`, `driver_id`, `vehicle_id`, `source` `{lat, lng, address}`, `destination` `{lat, lng, address}`, `route_geometry` `{type: LineString, coordinates: [...]}`, `distance_km`, `duration_min`, `depart_at`, `seats_offered`, `seats_available`, `status`, `created_at` | 2dsphere on `route_geometry.coordinates` |
| `bookings` | `_id`, `trip_id`, `passenger_id`, `driver_id`, `seats`, `status`, `pickup` `{lat, lng, address}`, `dropoff` `{lat, lng, address}`, `match_score`, `ai_score`, `ai_model`, `match_explain`, `created_at`, `closed_at` | compound on `(trip_id, status)` |
| `locations` | `_id`, `trip_id`, `point` `{type: Point, coordinates: [lng, lat]}`, `speed_kmph`, `accuracy_m`, `heading_deg`, `recorded_at`, `ttl` (30-day expiry) | 2dsphere on `point.coordinates`, TTL on `recorded_at` |
| `safety_alerts` | `_id`, `trip_id`, `type` (speeding\|deviation\|sos), `severity`, `status`, `point` `{lat, lng}`, `details`, `created_at`, `resolved_at` | compound on `(trip_id, status)` |
| `ratings` | `_id`, `booking_id`, `rater_id`, `target_id`, `stars` (1–5), `comment`, `created_at` | unique on `(booking_id, rater_id)` |
| `notifications` | `_id`, `user_id`, `type`, `title`, `body`, `priority`, `action`, `trip_id`, `booking_id`, `read_at`, `created_at` | compound on `(user_id, read_at)` |
| `segments` | `_id`, `trip_id`, `sequence`, `source`, `destination`, `distance_km`, `duration_min`, `polyline` | compound on `(trip_id, sequence)` |
| `phone_otps` | `_id`, `phone`, `code`, `expires_at`, `attempts`, `created_at` | TTL on `expires_at` (10 min) |
| `recurring_groups` | `_id`, `group_id`, `driver_id`, `base_trip_id`, `rule`, `starts_on`, `active`, `created_at` | unique on `group_id` |
| `ratings` | `_id`, `booking_id`, `rater_id`, `target_id`, `stars` (1–5), `comment`, `created_at` | unique on `(booking_id, rater_id)` |
| `notifications` | `_id`, `user_id`, `type`, `title`, `body`, `priority`, `action`, `trip_id`, `booking_id`, `read_at`, `created_at` | compound on `(user_id, read_at)` |

> **`init_db.py` is not optional.** Without it there are no unique, geo, TTL, or partial indexes — duplicate phone numbers become possible and geospatial queries fail silently.

## Directory structure (monorepo layout)

Each folder maps 1:1 to the 25 modules in `docs/`:

```text
carpooling/                         # monorepo root
├── README.md                       # this file
├── .env.example                    # full variable contract
├── .gitignore
├── backend/                        # FastAPI backend
│   ├── app/
│   │   ├── main.py                 # FastAPI entrypoint, CORS, mounts v1 router
│   │   ├── core/
│   │   │   ├── config.py           # ONLY env reader (Pydantic Settings)
│   │   │   ├── database.py         # shared Motor client + ping_db()
│   │   │   ├── deps.py             # get_current_user, require_roles, get_optional_user
│   │   │   ├── indexes.py          # 19 database index definitions
│   │   │   └── security.py         # hash/verify (PBKDF2), JWT create/decode, OTP gen/expiry
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── auth.py         # register, login, OTP request/verify, me, logout
│   │   │       ├── geo.py          # search, reverse, route endpoints
│   │   │       ├── bookings.py     # create, accept, complete, cancel
│   │   │       ├── trips.py        # create, get mine, get by id, route refresh
│   │   │       ├── search.py       # ride search with 4 knobs
│   │   │       ├── matching.py     # route-aware matching engine
│   │   │       ├── rank.py         # AI ranker info endpoint
│   │   │       ├── cost.py         # cost calculation per booking
│   │   │       ├── notifications.py# push/notifications handling
│   │   │       ├── ratings.py      # create, get ratings
│   │   │       ├── admin.py        # db admin endpoints
│   │   │       ├── vehicles.py     # vehicle CRUD
│   │   │       ├── profiles.py     # profile management
│   │   │       ├── recurring.py    # recurring ride series
│   │   │       └── router.py       # aggregation point; include_router for all v1 modules
│   │   ├── models/
│   │   │   ├── users.py
│   │   │   ├── vehicles.py
│   │   │   ├── trips.py
│   │   │   ├── bookings.py
│   │   │   ├── search.py           # validated search knobs
│   │   │   ├── profile.py
│   │   │   ├── rating.py
│   │   │   ├── notification.py
│   │   │   ├── segment.py
│   │   │   ├── telemetry_safety.py
│   │   │   └── common.py
│   │   ├── services/
│   │   │   ├── matching.py         # _xy, _seg_proj, project_onto_route, match_trip, match_fallback
│   │   │   ├── routing.py          # osrm_route(), nominatim_search(), nominatim_reverse()
│   │   │   ├── cost.py             # fuel-based cost per km + policy
│   │   │   ├── booking_window.py   # advance/notice windows
│   │   │   ├── segments.py         # trip segmentation
│   │   │   ├── tracking.py         # live tracking logic
│   │   │   ├── ratings.py          # rating computation
│   │   │   ├── rankings.py         # AI re-ranker (stdlib-only)
│   │   │   ├── moderation.py       # request moderation
│   │   │   └── analytics.py        # analytics aggregation
│   │   └── __init__.py
│   │   ├── modules/                    # feature modules (Module 10 detour, Module 12 cost)
│   │   │   ├── optimization/           # minimum-detour pickup optimisation (8-step route-snapping + corridor matching)
│   │   │   │   ├── service.py          # evaluate_detour() — route-snapping / corridor-matching algorithm
│   │   │   │   └── geo_utils.py        # haversine, project_onto_route, sub_polyline, cumulative_km, ...
│   │   │   └── cost/                   # cost calculation (compute_detour_contribution)
│   │   │       ├── calculator.py       # detour contribution cost formula
│   │   │       └── __init__.py
│   │   ├── scripts/                    # backend helper scripts (debug_detour_example.py)
│   ├── database/
│   │   ├── schemas/                # 7 JSON validators (users, vehicles, trips, bookings, segments, locations, safety_alerts)
│   │   │   └── overview.md         # ER sketch
│   │   └── indexes/                # 19 index scripts (mongosh + Python mirror)
│   ├── seed.py                     # demo accounts and week of history
│   ├── init_db.py                  # idempotent: create/collMod + ensure indexes
│   ├── tests/                      # 121 tests passing
│   │   └── fixtures/               # detour test fixtures (devanahalli_hebbal.json, yelahanka_hebbal.json)
│   └── requirements.txt
```
├── frontend/                       # Next.js frontend (App Router)
│   ├── app/
│   │   ├── layout.tsx              # root layout, theme provider, data-theme
│   │   ├── page.tsx                # Direction B landing shell
│   │   ├── global-error.tsx        # error boundary
│   │   ├── {login,register,verify,me}/# auth pages
│   │   ├── trips/                  # trip browsing and search
│   │   ├── garage/                 # driver vehicle management
│   │   ├── profile/                # user profile page
│   │   ├── requests/               # passenger trip requests
│   │   ├── bookings/               # booking management
│   │   ├── admin/                  # admin dashboard
│   │   ├── not-found.tsx           # 404 page
│   │   └── error.tsx               # error page
│   ├── components/
│   │   ├── BrandMark.tsx           # inline SVG logo
│   │   ├── RequireAuth.tsx         # auth guard wrapper
│   │   ├── SessionProvider.tsx     # session context
│   │   ├── SiteFooter.tsx          # site footer
│   │   ├── ui/
│   │   │   ├── Button.tsx          # primitive button
│   │   │   ├── Card.tsx            # primitive card
│   │   │   ├── Input.tsx           # primitive input
│   │   │   ├── Badge.tsx           # primitive badge
│   │   │   ├── Avatar.tsx          # primitive avatar
│   │   │   ├── Separator.tsx       # primitive separator
│   │   │   ├── TripCard.tsx        # trip list card
│   │   │   ├── RideCard.tsx        # ride/match card
│   │   │   ├── MatchCard.tsx       # match score card with AI blend & contributions drawer
│   │   │   ├── StatusPill.tsx      # status indicator pill
│   │   │   ├── ThemeToggle.tsx     # dark/light theme toggle
│   │   │   ├── LiveTrack.tsx       # live tracking visualization
│   │   │   ├── RouteMap.tsx        # Leaflet map with route display
│   │   │   ├── PlacePicker.tsx     # fuzzy catalogue + click-to-pin map
│   │   │   ├── PickupChooser.tsx   # pickup point selection on route
│   │   │   ├── StarPicker.tsx      # rating star picker
│   │   │   ├── Stars.tsx           # stars display
│   │   │   ├── CollectionCard.tsx  # collection/stop display
│   │   │   ├── FeatureGrid.tsx     # features grid
│   │   │   ├── LiveCorridorMap.tsx # corridor-aware route map
│   │   │   ├── SafetyBanner.tsx    # safety monitoring banner
│   │   │   ├── RateRideCard.tsx    # ride rating card
│   │   │   ├── TripCostCard.tsx    # cost breakdown card
│   │   │   ├── TrustSignals.tsx    # trust signals display
│   │   │   ├── VehicleArt.tsx      # vehicle art display
│   │   │   ├── VehicleCard.tsx     # vehicle card
│   │   │   ├── VehicleForm.tsx     # vehicle form
│   │   │   ├── BookingPanel.tsx    # booking confirmation panel
│   │   │   ├── MatchPipeline.tsx   # matching pipeline visualization
│   │   │   └── NotificationBell.tsx# notification bell
│   │   ├── admin/                  # admin-specific components
│   │   └── driver/                 # driver-specific components
│   ├── lib/
│   │   ├── api.ts                  # shared fetch wrapper with auth headers
│   │   ├── geo.ts                  # geo API client (search, reverse, route)
│   │   ├── search.ts               # MatchInfo, RideHit, Excluded types + rankInfo()
│   │   ├── auth.ts                 # typed auth client
│   │   ├── fuzzy.ts                # typo-tolerant place scoring
│   │   ├── places.ts               # Karnataka catalogue with scoring
│   │   └── live.ts                 # WebSocket live tracking subscription
│   ├── tailwind.config.js          # night/indigo/lime tokens, glow, type scale
│   ├── globals.css                 # base styles, night/lime tokens, Sora/Inter type scale
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.js
├── database/                       # MongoDB schema & index management
│   ├── schemas/                    # per-collection document shapes (users, vehicles, trips, bookings, segments, locations, safety_alerts)
│   └── indexes/                    # mongosh/js index scripts incl. 2dsphere
├── ml/                             # ML ranking / cost models (Module 16)
│   ├── artifacts/                  # ranker.json (logreg weights + model card)
│   ├── data/                       # make_dataset.py synthetic CSV
│   ├── features.py                 # 4 normalised signals (overlap, pickup, drop, time)
│   ├── make_dataset.py             # synthetic 4000-row dataset generation
│   ├── train_ranker.py             # train logreg/RF/XGBoost, export artifact
│   └── requirements.txt
├── docs/                           # One note per module (9-part template feeding SRS / final report)
│   ├── module-01-setup.md
│   ├── module-02-db-design.md
│   ├── module-03-auth.md
│   ├── module-04-profile.md
│   ├── module-05-vehicles.md
│   ├── module-06-trips.md
│   ├── module-07-maps.md
│   ├── module-08-search.md
│   ├── module-09-matching.md
│   ├── module-10-pickup-optimization.md
│   ├── module-11-bookings.md
│   ├── module-12-cost.md
│   ├── module-13-segments.md
│   ├── module-14-advance-booking.md
│   ├── module-15-recurring.md
│   ├── module-16-ai-ranking.md
│   ├── module-17-tracking.md
│   ├── module-18-safety.md
│   ├── module-19-completion.md
│   ├── module-20-streaming.md
│   ├── module-21-admin.md
│   ├── module-22-ratings.md
│   ├── module-23-notifications.md
│   ├── module-24-analytics.md
│   └── module-25-deploy.md
├── .env.example                    # root/backend/frontend full variable contract
├── start-dev.bat / start-dev.ps1   # development startup scripts
├── setup.py                        # project setup script
└── package-lock.json
```

## Environment setup

### Variable contract (.env.example at root + per-service)

```text
# ======================
# APPLICATION SETTINGS
# ======================
APP_ENV=development               # or "production"
JWT_SECRET=change-this-to-32-plus-random-chars
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
NEXT_PUBLIC_API_URL=http://localhost:8000

# ======================
# MONGODB
# ======================
MONGO_URI=mongodb://localhost:27017
MONGO_DB=vehicle_sharing_dev

# ======================
# GEO / ROUTING
# ======================
OSRM_URL=https://router.project.osrm.org
NOMINATIM_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=carpooling/1.0 (https://github.com/BalajiTV04/carpooling; contact: dev@localhost)

# ======================
# MATCHING KNOBS (Module 9)
# ======================
MAX_PICKUP_KM=3                  # max walking distance for pickup
MAX_DETOUR_KM=5                  # max extra distance for driver
MIN_OVERLAP_PCT=20               # minimum route overlap percentage
INCLUDE_EXCLUDED=false           # whether to include excluded trips

# ======================
# MINIMUM-DETOUR PICKUP (Module 10)
# ======================
PICKUP_SNAP_KM=0.5               # max walk to snap pickup onto driver route (km)
MAX_PICKUP_DISTANCE_KM=3.0       # max walking distance to pickup point
DEST_TOLERANCE_KM=2.0            # drop must be within this of driver route/destination
MAX_DETOUR_KM=3.0                # max extra distance for driver (detour gate)
MAX_EXTRA_MIN=10.0               # max extra driving time (min)
FUEL_PRICE_PER_LITRE=100.0       # fuel price for cost contribution
COST_SPLIT_POLICY=EQUAL_SPLIT    # cost split policy (EQUAL_SPLIT / FULL_PASSENGER_SHARE)
INCLUDE_DETOUR_COST=false        # whether detour fuel is added to passenger share

# ======================
# ADVANCE BOOKING (Module 14)
# ======================
ADVANCE_MAX_DAYS=30              # max days ahead a booking may be made
ADVANCE_MIN_NOTICE_MIN=60        # minimum notice before departure (minutes)

# ======================
# RECURRING RIDES (Module 15)
# ======================
RECURRING_HORIZON_DAYS=21        # days of recurring instances materialised
RECURRING_MAX_DAYS=90            # hard ceiling for a recurring series

# ======================
# PRODUCTION GUARD (Module 25)
# ====================
# config.validate_production(settings) checks:
#   - JWT_SECRET is not the shipped dev value → blocked (anyone could forge a token)
#   - JWT_SECRET shorter than 32 chars → blocked
#   - CORS_ORIGINS empty → blocked
#   - a CORS_ORIGINS entry that is plain http and not localhost → blocked
```

### Environment files

- `.env.example` — template at repo root; copy to `.env` for backend and `.env.local` for frontend
- `.env.prod` — production environment (never committed); edit `.env.example` → `.env.prod` for deploy
- Per-service overrides: `backend/.env`, `frontend/.env.local`

### Frontend-only variables (`frontend/.env.local`)

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | yes | `http://localhost:8000` | Base URL of the FastAPI backend (used by `fetch`/`axios` calls) |
| `NEXT_PUBLIC_MAP_PROVIDER` | no | `osrm` | Routing provider name — matched against `backend` `ROUTING_PROVIDER` |
| `NEXT_PUBLIC_OSRM_URL` | no | `https://router.project-osrm.org` | OSRM server URL for route geometry / ETA |
| `NEXT_PUBLIC_NOMINATIM_URL` | no | `https://nominatim.openstreetmap.org` | Nominatim URL for forward / reverse geocoding |

> Frontend env vars are **injected at build time**. Changing `.env.local` requires `npm run build` again (or `npm run dev` restart).

### Running with Docker Compose

```powershell
# Development
# MongoDB: local mongod or Atlas cluster
cd backend
copy .env.example .env              # generate from template
python init_db.py                   # create collections + validators + indexes
python seed.py                      # optional: demo accounts + history
uvicorn app.main:app --reload --port 8000

cd ..\frontend
npm install
copy .env.example .env.local
npm run dev                         # http://localhost:3000
```

## How to run locally

### Option 1 — Full monorepo (recommended)

```powershell
# 1. Start MongoDB (Docker)
docker compose up -d mongo

# 2. Backend
cd backend
copy .env.example .env
python init_db.py           # REQUIRED: collections + validators + indexes
python seed.py              # optional: demo accounts + history
python -m pytest -q         # run: 147 tests passing
uvicorn app.main:app --reload --port 8000
# expect at http://localhost:8000/api/v1/health:
# {"status":"ok","service":"Intelligent Vehicle Sharing API","db":"disconnected","routing_provider":"osrm"}

# 3. Frontend
cd ..\frontend
copy .env.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

### Option 2 — Backend only

```powershell
cd backend
copy .env.example .env
python init_db.py
uvicorn app.main:app --reload --port 8000
```

### Option 3 — Frontend only (static HTML/CSS port)

> ⚠️ This is a separate static HTML/CSS port — no React, no Next.js, no build step.

```powershell
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

### Option 4 — Manual backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python init_db.py
python seed.py
uvicorn app.main:app --reload --port 8000
```

### Frontend manual

```powershell
cd frontend
npm install
npm run dev                   # http://localhost:3000
npm run build                 # production build
npm run start                 # serve production build
```

### Health check

```powershell
# Expect: {"status":"ok","service":"Intelligent Vehicle Sharing API","db":"disconnected","routing_provider":"osrm"}
curl http://localhost:8000/api/v1/health

# Ready check (200 only when Mongo answers)
curl http://localhost:8000/api/v1/ready

# Version check (git sha, app env, python version)
curl http://localhost:8000/api/v1/version
```

## API reference (overview)

**Base URL:** `http://localhost:8000/api/v1`

### Authentication endpoints (`/auth/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/auth/register` | Register a new user | `phone` (E.164), `password`, `full_name`, `roles` [passenger\|driver] | `201` + `access_token`, `user` object |
| `POST` | `/auth/login` | Login user | `phone`, `password` | `access_token`, `user` object |
| `POST` | `/auth/otp/request` | Request OTP for phone verification | `phone` (E.164) | `code` (displayed on screen, dev mode) |
| `POST` | `/auth/otp/verify` | Verify OTP code | `phone`, `code` | `phone_verified` bool, `success` message |
| `GET` | `/auth/me` | Get current user profile | `Authorization: Bearer <token>` | `user` object with profile details |
| `POST` | `/auth/logout` | Stateless logout | `Authorization: Bearer <token>` | `success` message |

### Geo / routing endpoints (`/geo/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `GET` | `/geo/search?q=` | Fuzzy place search | `q` (query string, min 3 chars) | List of place objects with `name`, `latitude`, `longitude`, `score` |
| `GET` | `/geo/reverse` | Reverse geocode | `lat`, `lng` | Place name string |
| `POST` | `/geo/route` | Preview route between two places | `src` (origin name), `dst` (destination name) | `{routed: bool, distance_km: float, duration_min: float, geometry: LineString}` |
| `POST` | `/trips/{id}/route/refresh` | Refresh route geometry for trip | Trip owner auth | Updated trip with new `route_geometry`, `distance_km`, `duration_min` |

### Trip endpoints (`/trips/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `GET` | `/trips` | List trips with optional filters | `from`, `to` query params | Paginated list of trip summaries |
| `POST` | `/trips` | Create new trip with fuel & other expenses calculations and driver-selected route | `source`, `destination`, `depart_at`, `seats_offered`, `trip_type` (`live` \| `monthly` \| `long`), `fuel_type`, `fuel_price_per_unit`, `other_expenses` (list of `{name, amount}`), `other_expenses_total`, `route_geometry`, `route_index` | Created draft trip with `id`, `total_cost`, `cost_per_seat`, `monthly_cost`, `route_geometry`, `route_alternatives`, `status: "draft"` |
| `GET` | `/trips/available` | Search active trips matching destination/source corridor (shows "Seat Over" badge for sold-out trips) | `destination`, `source`, `trip_type`, `dst_lat`, `dst_lng`, `src_lat`, `src_lng` | List of available and sold-out trips with `seats_left`, `is_sold_out`, `status_badge`, `cost_per_seat`, `other_expenses_total` |
| `GET` | `/trips/{trip_id}` | Get trip by ID | — | Full trip object with all fields |
| `GET` | `/trips/mine` | Get current user's trips | `Authorization: Bearer <token>` | List of user's trips |
| `POST` | `/trips/{trip_id}/complete` | Mark destination reached & complete trip | Trip owner auth | Updated trip with `status: "completed"`, triggers rating requests for all riders |
| `POST` | `/trips/{trip_id}/submit` | Driver submits draft trip for admin approval | Trip owner auth | Trip with `status: "pending_approval"` |
| `POST` | `/trips/{trip_id}/publish` | Publish approved trip to make it bookable | Trip owner or admin auth | Trip with `status: "published"` |
| `POST` | `/trips/{trip_id}/cancel` | Driver cancels trip | Trip owner auth | Cancelled trip + all passenger bookings refunded/cancelled |

### Search / matching endpoints (`/search/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `GET` | `/search/rides` | Search for available rides | `max_pickup_km` (default 3), `max_detour_km` (default 5), `min_overlap_pct` (default 20), `include_excluded` (default false) | `{results: [...], excluded: [...], match: {...}, ai: {...}}` |

### Minimum-detour search endpoints (`/rides/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/rides/search-with-detour` | Minimum-detour ride search — evaluates every published trip that day with the detour optimiser (`app/modules/optimization/service.py`, 8-step route-snapping + corridor matching) and returns feasible matches enriched with driver, vehicle, seats, pickup/drop points and estimated cost contribution | Body: `source {lat, lng, address}`, `destination {lat, lng, address}`, `date (YYYY-MM-DD)`, `time (HH:MM)` optional, `seats (int, default 1)` | `{count, date, source, destination, results: [{trip_id, driver_name, vehicle {make, model, plate_no, fuel_type, mileage_kmpl}, seats_available, departure_time, pickup_point {lat, lng, address}, drop_point {lat, lng, address}, walk_distance_km, detour_km, extra_time_min, passenger_distance_km, estimated_contribution, estimated, route_overlap_percent, driver_route_polyline, passenger_segment_polyline}]}` |

### Booking endpoints (`/bookings/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/bookings` | Create a booking on an open trip | `trip_id`, `seats`, `pickup_coordinates`, `dropoff_coordinates`, `use_optimised_pickup` | `201` + `booking` object with `id`, `status: "requested"`, `cost_share`, `estimated_contribution` |
| `GET` | `/bookings` | List bookings | `Authorization: Bearer <token>` | Paginated list of bookings |
| `GET` | `/bookings/mine` | Get current passenger's bookings with live fare change history | `Authorization: Bearer <token>` | List of bookings with `previous_amount`, `cost_share`, `fare_changed`, `fare_history`, `status` |
| `GET` | `/bookings/incoming` | Driver views incoming ride requests waiting for approval | `Authorization: Bearer <token>` | List of booking requests with passenger details |
| `POST` | `/bookings/{booking_id}/accept` | Driver approves passenger booking | Driver auth | Updated booking `status: "accepted"`, triggers dynamic fare recalculation for all riders |
| `POST` | `/bookings/{booking_id}/reject` | Driver declines passenger booking | Driver auth | Updated booking `status: "rejected"` |
| `POST` | `/bookings/{booking_id}/cancel` | Passenger cancels ride (allowed for `requested`, `accepted`, `confirmed` up to departure/completion) | Passenger auth | Booking `status: "cancelled"`, restores seat capacity, dynamically recalculates remaining fares |
| `GET` | `/bookings/{booking_id}` | Get booking details | — | Full booking object |

### Tracking endpoints (`/tracking/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/tracking/{trip_id}/start` | Driver starts active GPS tracking for a trip | Trip owner auth | `{ok, trip_id, status, message}` |
| `POST` | `/tracking/{trip_id}/stop` | Driver ends ride & stops tracking; completes trip + resolves bookings | Trip owner or admin | `{ok, trip_id, status, message}` |
| `POST` | `/tracking/ping` | Driver sends device GPS fix (no trip_id in path) | `trip_id`, `lng`, `lat`, optional `speed_kmph`, `accuracy_m`, `heading_deg` | `{ok, started, progress, recorded_at, ...}` |
| `POST` | `/tracking/{trip_id}/location` | Driver sends GPS fix for a specific trip | Same body as `/ping` | `{ok, started, progress, recorded_at, ...}` |
| `GET` | `/tracking/live/{trip_id}` | Latest fix + route progress + ETA for trip audience (driver, booked passengers, admin) | Trip audience auth | `{trip_id, trip_status, fix, progress, stale, message}` |
| `GET` | `/tracking/trail/{trip_id}` | Recent GPS breadcrumb trail (newest first) for map polyline | Trip audience auth | `{trip_id, trip_status, count, fixes: [...]}` |
| `GET` | `/admin/tracking/active` | Fleet-wide live monitoring: all active trips with latest fix, progress, open alerts, watcher count | Admin auth | `{count, trips: [...]}` |

### Vehicle endpoints (`/vehicles/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/vehicles` | Register a vehicle | `plate` (unique), `verified` bool, `seating_capacity` int | Created vehicle object |
| `GET` | `/vehicles` | List vehicles | — | List of vehicle objects |

### Profile endpoints (`/profiles/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `GET` | `/profiles/me` | Get current user profile | `Authorization: Bearer <token>` | User profile object |
| `PATCH` | `/profiles/me` | Update profile | `full_name`, `phone`, `roles` [passenger\|driver] | Updated profile object |

### Admin endpoints (`/db/`)

| Method | Endpoint | Description | Request | Response |
|---|---|---|---|---|
| `GET` | `/db/stats` | Database statistics | — | `{trips: int, users: int, vehicles: int, ...}` |
| `GET` | `/db/schema/{collection}` | Get collection schema | Collection name | JSON schema validator |
| `POST` | `/db/init` | Initialize database | — | `created: ×7, indexes ensured: 19` |

### Health / ready / version probes

| Endpoint | Description | Response |
|---|---|---|
| `GET /api/v1/health` | Always 200 while process is up | `{"status":"ok","service":"Intelligent Vehicle Sharing API","db":"disconnected","routing_provider":"osrm"}` |
| `GET /api/v1/ready` | 200 only when Mongo answers | `{"ready":true}` or `{"ready":false, "reason":"db disconnected"}` |
| `GET /api/v1/version` | Git sha, app env, python version | `{"git_sha":"abc123","app_env":"development","python_version":"3.8.10"}` |

Full OpenAPI spec is available at `/docs` (Swagger UI) and `/redoc`.

### Admin endpoints (`/admin/`) — Module 21 (admin role required)

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/admin/stats` | Dashboard cards with derived metrics | `Authorization: Bearer <admin token>` | `{trips, users, vehicles, bookings, alerts, ...}` |
| `GET` | `/admin/users` | Search + filter the user base | `Authorization: Bearer <admin token>` | Paginated list of user rows |
| `POST` | `/admin/users/{id}/suspend` | Lock an account (live JWTs die immediately) | `Authorization: Bearer <admin token>` | `{ok, user_id, status}` |
| `POST` | `/admin/users/{id}/reactivate` | Undo a suspension | `Authorization: Bearer <admin token>` | `{ok, user_id, status}` |
| `POST` | `/admin/users/{id}/roles` | Add/remove driver | passenger | admin roles | `Authorization: Bearer <admin token>`, body: `roles` array | Updated user roles |
| `GET` | `/admin/trips` | Cross-driver trip board | `Authorization: Bearer <admin token>` | Paginated list of all trips |
| `GET` | `/admin/alerts` | Moderation queue (open + critical first) | `Authorization: Bearer <admin token>` | List of safety alerts |
| `POST` | `/admin/alerts/{id}/resolve` | Close a safety alert | `Authorization: Bearer <admin token>` | `{ok, alert_id, status}` |
| `GET` | `/admin/tracking/active` | Fleet-wide live monitoring: all active trips with latest fix, progress, open alerts, watcher count | `Authorization: Bearer <admin token>` | `{count, trips: [...]}` |

### Ratings endpoints (`/ratings/`) — Module 22

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `POST` | `/ratings` | Rate the other party on a completed booking | `{booking_id, stars, comment?}` | `201` + rating object |
| `GET` | `/ratings/pending` | Completed rides I was part of, with my own score (null = not rated yet) | `Authorization: Bearer <token>` | `{count, unrated, items: [...]}` |
| `GET` | `/ratings/booking/{id}` | The (0..2) reviews on one booking; parties only | `Authorization: Bearer <token>` | `{booking_id, count, items: [...]}` |
| `GET` | `/ratings/user/{id}` | Public review card: aggregate + histogram + recent feed | `Authorization: Bearer <token>` | `RatingCard` object |

### Notifications endpoints (`/notifications/`) — Module 23

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/notifications` | My feed (newest first, unread first) | `Authorization: Bearer <token>` | `{count, unread, critical, by_type, items: [...]}` |
| `GET` | `/notifications/summary` | Bell counts only `{unread, critical, by_type}` | `Authorization: Bearer <token>` | `{unread, critical, by_type}` |
| `POST` | `/notifications/{id}/read` | Mark one notification read (own only) | `Authorization: Bearer <token>` | Notification object |
| `POST` | `/notifications/read-all` | Mark everything read | `Authorization: Bearer <token>` | `{marked: int}` |

### Segments endpoints (`/segments/`) — Module 13

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/segments` | List route segments for a trip | `trip_id` query param | List of segment objects |
| `POST` | `/segments` | Create / update a segment | Segment definition | Created segment object |

### Safety endpoints (`/safety/`) — Module 18

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/safety/alerts` | Open safety alerts for a trip | `trip_id` query param | List of safety alert objects |
| `POST` | `/safety/alerts` | Raise a safety event (speeding, deviation, SOS) | Event body | Created alert object |
| `POST` | `/safety/alerts/{id}/resolve` | Resolve an open alert | `Authorization: Bearer <token>` | `{ok, alert_id, status}` |

### Fuel endpoints (`/fuel/`) — Module 12 (cost engine)

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/fuel/prices` | Current fuel prices per litre (petrol, diesel, CNG, EV, hybrid) | — | `{petrol, diesel, cng, ev, hybrid}` |
| `POST` | `/fuel/calculate` | Estimate fuel cost for a route | `{distance_km, fuel_type, mileage_kmpl}` | `{cost_inr, litres}` |

### Cost endpoints (`/cost/`) — Module 12

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/cost/split` | Compute fair cost split for a booking | `booking_id` query param | `{per_passenger, total, policy}` |
| `POST` | `/cost/policy` | Set cost split policy (EQUAL_SPLIT / FULL_PASSENGER_SHARE) | `{policy}` | `{policy, updated}` |

### Recurring endpoints (`/recurring/`) — Module 15

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `POST` | `/recurring` | Create a recurring ride series | `{template_trip, horizon_days, max_days}` | Created recurring series object |
| `GET` | `/recurring` | List my recurring series | `Authorization: Bearer <token>` | Paginated list of recurring series |
| `PATCH` | `/recurring/{id}` | Update a recurring series | Fields to update | Updated series object |
| `DELETE` | `/recurring/{id}` | Cancel a recurring series | `Authorization: Bearer <token>` | `{ok, id}` |

### Advance booking endpoints (`/advance/`) — Module 14

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `POST` | `/advance/bookings` | Book a trip in advance (max 30 days ahead) | `{trip_id, seats, depart_at}` | `201` + advance booking object |
| `GET` | `/advance/bookings` | List my advance bookings | `Authorization: Bearer <token>` | Paginated list |
| `PATCH` | `/advance/bookings/{id}/cancel` | Cancel an advance booking | `Authorization: Bearer <token>` | `{ok, booking_id, status}` |

### Completion endpoints (`/completion/`) — Module 19

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `POST` | `/completion/{booking_id}` | Mark a ride as completed + record safety summary | `Authorization: Bearer <token>` | `{ok, booking_id, status, summary}` |
| `GET` | `/completion/{booking_id}` | Get completion summary for a booking | `Authorization: Bearer <token>` | Completion summary object |

### Streaming endpoints (`/stream/`) — Module 20 (WebSocket)

| Endpoint | Description | Query params | Notes |
|--------|----------|--------------|-------|
| `WS /api/v1/stream/trips/{trip_id}` | Live GPS tracking frames for a trip audience | `token` (JWT auth) | Single uvicorn worker required — in-process hub registry |
| `WS /api/v1/stream/fleet` | Fleet-wide live tracking for admin dashboard | `token` (admin JWT auth) | Broadcasts active-trip fixes to all admin watchers |

### Health / ready / version probes

| Endpoint | Description | Response |
|----------|-------------|----------|
| `GET /api/v1/health` | Always 200 while process is up | `{"status":"ok","service":"Intelligent Vehicle Sharing API","db":"disconnected","routing_provider":"osrm"}` |
| `GET /api/v1/ready` | 200 only when Mongo answers | `{"ready":true}` or `{"ready":false, "reason":"db disconnected"}` |
| `GET /api/v1/version` | Git sha, app env, python version | `{"git_sha":"abc123","app_env":"development","python_version":"3.8.10"}` |

### What it does

Given a passenger's source, destination, travel date/time and seat count, `POST /api/v1/rides/search-with-detour` finds published trips whose route can carry the passenger with the least extra distance for the driver. For every published trip that day it runs the detour optimiser (`backend/app/modules/optimization/service.py`) and returns only feasible matches, ranked by detour distance, walking distance and departure-time proximity.

### Algorithm (8 steps)

1. **Fetch route** — get the driver's routed polyline from OSRM (haversine straight-line fallback if OSRM is unavailable; result flagged `estimated:true`).
2. **Snap pickup** — project the passenger's source onto the driver's polyline to find the best pickup point `P` (within `MAX_PICKUP_DISTANCE_KM` walk).
3. **Project drop** — project the passenger's destination onto the polyline to find drop point `Q`; require `Q` to be ahead of `P` (forward direction).
4. **Direction gate** — reject if `Q` is not after `P` ("wrong direction / drop before pickup").
5. **Destination gate** — require `Q` to be within `DEST_TOLERANCE_KM` of the driver's destination.
6. **Passenger distance** — shared distance = cumulative(Q) − cumulative(P); must be > 0.
7. **Feasibility limits** — detour ≤ `MAX_DETOUR_KM` (3 km), extra time ≤ `MAX_EXTRA_MIN` (10 min), pickup walk ≤ `MAX_PICKUP_DISTANCE_KM` (3 km); optional date/time window (±120 min).
8. **Cost contribution** — price the share with `compute_detour_contribution` (`backend/app/modules/cost/calculator.py`) using route distance, time, mileage, fuel price, occupant count and the `COST_SPLIT_POLICY`.

### Response fields

Each result includes `trip_id`, `driver_name`, `vehicle`, `seats_available`, `departure_time`, `pickup_point`, `drop_point`, `walk_distance_km`, `detour_km`, `extra_time_min`, `passenger_distance_km`, `estimated_contribution`, `estimated`, `route_overlap_percent`, `driver_route_polyline` and `passenger_segment_polyline`.

### Frontend

- `frontend/lib/search.ts` — `DetourRideResult`, `DetourSearchBody` types + `ridesWithDetour()` client.
- `frontend/components/DetourRideCard.tsx` — detour-optimised ride result card (pickup/drop strip, detour stats, driver route + passenger segment map).
- `frontend/app/search/page.tsx` — search page wires up `detourHits` / `DetourRideCard`.

### Config knobs (`.env`)

| Knob | Default | Meaning |
|---|---|---|
| `PICKUP_SNAP_KM` | `0.5` | max walk to snap pickup onto driver route (km) |
| `MAX_PICKUP_DISTANCE_KM` | `3.0` | max walking distance to pickup point |
| `DEST_TOLERANCE_KM` | `2.0` | drop must be within this of driver route/destination |
| `MAX_DETOUR_KM` | `3.0` | max extra distance for driver (detour gate) |
| `MAX_EXTRA_MIN` | `10.0` | max extra driving time (min) |
| `FUEL_PRICE_PER_LITRE` | `100.0` | fuel price for cost contribution |
| `COST_SPLIT_POLICY` | `EQUAL_SPLIT` | `EQUAL_SPLIT` or `FULL_PASSENGER_SHARE` |
| `INCLUDE_DETOUR_COST` | `false` | whether detour fuel is added to passenger share |

## Frontend routes & components

### App router routes (`frontend/app/`)

| Route | Description |
|---|---|
| `/` | Direction B landing shell — health pill, map placeholder |
| `/login` | Login page with phone input |
| `/register` | Register page — phone + password + roles selector |
| `/verify` | OTP verification page (shows dev code) |
| `/me` | User profile page (requires auth) |
| `/trips` | Trip search and browse — type From/To → auto route preview → stage → publish |
| `/garage` | Driver vehicle management — add/view vehicles |
| `/profile` | User profile editing |
| `/requests` | Passenger trip requests / received matches |
| `/bookings` | Booking management |
| `/admin` | Admin dashboard (db stats, init, schema) |
| `/not-found` | 404 page |
| `/error` | Error page |

### Key UI components (components/ui/)

**Primitives:**

- `Button` — styled button with variants (primary, secondary, danger, ghost)
- `Card` — content card with header/footer
- `Input` — form input with label
- `Badge` — status/role badge
- `Avatar` — user initials/icon
- `Separator` — horizontal rule variant
- `TripCard` — trip list item card
- `RideCard` — ride/match card with drawer map
- `MatchCard` — match score card with AI blend badge, `rule + AI → blended` line, and contributions drawer
- `DetourRideCard` — detour-optimised ride result card (pickup/drop strip, detour stats, driver route + passenger segment map)
- `VehicleTrackingCard` — live vehicle tracking card (GPS fix, trail, speed, remaining km, map)
- `StatusPill` — status indicator (pending, confirmed, in-progress, completed, cancelled)
- `ThemeToggle` — dark/light theme toggle (respects `prefers-reduced-motion`)
- `LiveTrack` — live tracking visualization on map
- `RouteMap` — Leaflet-based route map display with night CSS filter, indigo route + lime dashes, glow markers
- `PlacePicker` — fuzzy catalogue dropdown + click-to-pin map
- `PickupChooser` — pickup point selection on the driver's route (shows pickup_km, detour_km)
- `StarPicker` — rating star selector (1-5)
- `Stars` — stars display (filled/half/empty)
- `CollectionCard` — stop/collection display (for recurring/segments)
- `FeatureGrid` — feature grid layout
- `LiveCorridorMap` — corridor-aware route map (highlights shared route segments)
- `SafetyBanner` — safety monitoring banner (shows active safety events)
- `RateRideCard` — ride rating card (post-trip)
- `TripCostCard` — cost breakdown card (per booking)
- `TrustSignals` — trust signals display (phone verified, trip history)
- `VehicleArt` — vehicle art/logo display
- `VehicleCard` — vehicle information card
- `VehicleForm` — vehicle registration form
- `BookingPanel` — booking confirmation panel
- `MatchPipeline` — matching pipeline visualization
- `NotificationBell` — notification bell with count
- `AdminFleetMap` — admin fleet-wide live tracking map with active trips, latest fixes, and open alerts
- `DriverTrackingConsole` — driver console for starting/stopping live GPS tracking during an active ride

### Lib modules (`frontend/lib/`)

- `api.ts` — shared fetch wrapper with auth headers (`Authorization: Bearer <token>`)
- `geo.ts` — geo API client (search, reverse, route)
- `search.ts` — `MatchInfo`, `RideHit`, `Excluded` types + `rankInfo()` for AI blend display; `DetourRideResult`, `DetourSearchBody` + `ridesWithDetour()` for minimum-detour search
- `auth.ts` — typed auth client (login, register, OTP, me, logout)
- `fuzzy.ts` — typo-tolerant place scoring
- `places.ts` — Karnataka catalogue with scoring
- `tracking.ts` — `LiveFix`, `Trail`, `ActiveFleetTrip` types + `trackingApi` (start / stop / ping / location / live / trail / activeFleet) for vehicle tracking and admin fleet monitoring
- `live.ts` — WebSocket live tracking subscription (origin from `NEXT_PUBLIC_API_URL`)

## Design system (Tailwind)

### Color palette (night/indigo/lime theme)

- **Dark background**: Indigo `#0B1030` (primary) / `#7B77FF` (accent)
- **Light background**: Lime `#C6FF4A` (accent)
- **Text**: Off-white / charcoal for readability
- **Success/positive**: Lime green tones
- **Error/negative**: Red/orange tones

### Typography

- **Display**: Sora (weight 400, 500, 600, 700)
- **Body**: Inter (weight 400, 500)
- **Type scale**: fluid scaling via Tailwind's `text-[<size>]` syntax

### Custom CSS variables (globals.css)

```css
:root {
  --bg: #0B1030;           /* dark mode background */
  --fg: #E6E9F0;           /* dark mode foreground */
  --accent: #C6FF4A;       /* lime accent */
  --muted: #6B6B80;
  --border: #3A3F5F;
}
```

### Theme toggle

Dark/light is toggled via `data-theme` on `<html>` (default dark). Respects `prefers-reduced-motion`. The toggle component (`ThemeToggle.tsx`) updates the `<html>` attribute and persists the preference via `localStorage`.

### Component variants

Tailwind variants used throughout:

- `hover:bg-card-hover` / `hover:border-line-hover` — card hover states
- `group-hover:` / `group-focus-in:` — group descendant hover
- `peer-checked:` — peer checked state styling
- `data-[state=open]:` — open state styling
- `motion-safe:` / `motion-reduce:` — reduced motion variants

## Testing

### Test summary

- **Total tests:** 147 passing
- **Backend tests:** `pytest -q` — all modules green
- **Test distribution by module:**

| Area | Tests |
|---|---|
| Health/smoke | 2 |
| Database design | 9 |
| Authentication (4 crypto + live E2E) | 14 |
| Geo/routing | 19 |
| Matching | 27 |
| AI ranking | 65 |
| Tracking (live GPS, trail, fleet) | 26 |
| Deploy/runbook | 7 |
| **Total** | **147** |

### Running tests

```powershell
# Backend
cd backend
python -m pytest -q                    # 147 passed
python -m pytest -q -p no:cacheprovider  # verbose, no cache
python -m pytest tests/test_matching.py -q -p no:cacheprovider  # 27/27
python -m pytest tests/test_ranker.py -q -p no:cacheprovider     # 65/65
python -m pytest tests/test_geo.py -q -p no:cacheprovider          # 19/19
python -m pytest tests/test_auth.py -q -p no:cacheprovider          # 14/14
python -m pytest tests/test_deploy.py -q -p no:cacheprovider        # 7/7
```

### Test quality principles

- **Pure units first**: geometry projection tests have no external deps
- **Live tests use isolated data**: each live test seeds its own day (+2/+3) and cleans up after
- **AI never overrides hard constraints**: test that gated rides get `ai_score=None`
- **Blended score transparency**: test that the ring shows blended, card decomposes rule + AI
- **Commit hook**: Run `npm run typecheck` and `python -m pytest -q` before opening a pull request.

## 25-module roadmap

The application is organized into 25 self-documenting modules (docs/), each following a 9-part template (Concept/why, Prerequisites, DB changes + endpoints, Code map, Integration, Run + test, Common errors, Commit message, SRS/report notes). Status as of this README:

| Module | Title | SRS/Report |
|---|---|---|
| 1 | Project setup | ✅ scaffolded |
| 2 | Database design | ✅ VERIFIED live |
| 3 | Authentication | ✅ VERIFIED |
| 4 | Profile | — |
| 5 | Vehicles | — |
| 6 | Trips | — |
| 7 | Map integration + routing | ✅ VERIFIED |
| 8 | Search | — |
| 9 | Route-aware matching engine | ✅ VERIFIED |
| 10 | Pickup optimization | ✅ VERIFIED |
| 11 | Bookings | — |
| 12 | Cost | — |
| 13 | Segments | — |
| 14 | Advance booking | — |
| 15 | Recurring rides | — |
| 16 | AI ride ranking | ✅ VERIFIED |
| 17 | Tracking | ✅ VERIFIED |
| 18 | Safety | — |
| 19 | Completion | — |
| 20 | Streaming | — |
| 21 | Admin | — |
| 22 | Ratings | — |
| 23 | Notifications | — |
| 24 | Analytics | — |
| 25 | Deploy & harden | ✅ VERIFIED |

**Overall status:** **25 / 25 modules complete** · **147 tests passing** · **92 API routes** · **11 MongoDB collections**

**License:** Private project — see repository for distribution terms.

**Status:** **25 / 25 modules complete · 147 tests passing · 92 API routes · 11 collections**

A private-vehicle sharing platform that matches riders to drivers travelling the same corridor, picks the pickup point that costs the driver the least extra distance, prices the share fairly, then tracks the ride and watches for safety events while it happens.

## Deployment

VoltRide deploys to **Vercel (frontend)** + **Render (backend)** + **MongoDB Atlas (database)**.

### Development

```powershell
# MongoDB: local mongod or Atlas cluster
cd backend
copy .env.example .env              # generate from template
python init_db.py                   # create collections + validators + indexes
python seed.py                      # optional: demo accounts + history
uvicorn app.main:app --reload --port 8000

cd ..\frontend
npm install
copy .env.example .env.local
npm run dev                         # http://localhost:3000
```

### Production — Vercel (Frontend)

1. Push the repo to GitHub and connect it to Vercel.
2. In Vercel project settings, set **Root Directory** to `frontend`.
3. Add these environment variables (match `frontend/.env.prod.example`):
   - `NEXT_PUBLIC_API_URL=https://your-backend.onrender.com/api/v1`
   - `NEXT_PUBLIC_MAP_PROVIDER=osrm`
   - `NEXT_PUBLIC_OSRM_URL=https://router.project-osrm.org`
   - `NEXT_PUBLIC_NOMINATIM_URL=https://nominatim.openstreetmap.org`
4. Deploy. Vercel runs `npm ci && npm run build` and serves from `.next`.

**Note:** `NEXT_PUBLIC_*` values are inlined at **build time**. Changing them requires a redeploy.

### Production — Render (Backend)

1. Connect the repo to Render and create a **Web Service**.
2. Set **Root Directory** to the repo root (or use `backend/render.yaml` as a blueprint).
3. Build command: `pip install -r backend/requirements.txt`
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1`
5. Add environment variables (match `backend/.env.prod.example`):
   - `APP_ENV=production`
   - `MONGO_URI=<your MongoDB Atlas connection string>`
   - `MONGO_DB=vehicle_sharing_dev`
   - `JWT_SECRET=<32+ random characters>`
   - `CORS_ORIGINS=https://your-frontend.vercel.app`
   - `NOMINATIM_USER_AGENT=<your deployment contact string>`
6. Set **Health Check Path** to `/api/v1/ready`.

**Important:** Keep `--workers 1`. The Module 20 WebSocket hub is an **in-process** registry, so multiple workers would give each worker its own watchers and clients would silently stop receiving live frames. Scale-out requires Redis pub/sub behind `hub.broadcast()`.

**Reverse proxy must forward the `Upgrade` header** for `WS /api/v1/stream/trips/{id}`, or live tracking silently degrades.

### Production — MongoDB Atlas

1. Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Create a database user with read/write access.
3. Add your Render backend's outbound IP to the Atlas Network Access list (or allow 0.0.0.0/0 for development).
4. Get the connection string: `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/vehicle_sharing_dev?retryWrites=true&w=majority`
5. Set `MONGO_URI` in Render to this string, and `MONGO_DB=vehicle_sharing_dev`.

**One-time initialization:** After deploying the backend, run `python init_db.py` against the production database once:

```powershell
cd backend
copy .env.example .env
# Edit .env: MONGO_URI=<atlas-connection-string>
python init_db.py
```

`init_db.py` is **idempotent** — re-running is safe.

### Production gotchas

1. **`NEXT_PUBLIC_*` is inlined at BUILD time.** Setting it at run time does nothing — the bundle is already compiled. It is a build ARG in `frontend/Dockerfile`; changing it needs a rebuild or redeploy.
2. **Single uvicorn worker, on purpose.** Module 20's WebSocket hub is an in-process registry, so `--workers 2` would give each worker its own watchers and half the clients would silently stop receiving frames. Scale-out needs a shared bus (Redis pub/sub or NATS) behind `hub.broadcast()`.
3. **Reverse proxy must forward the `Upgrade` header** for `WS /api/v1/stream/trips/{id}`, or live tracking silently degrades to nothing.
4. **`python init_db.py` is not optional.** Without it there are no unique, geo, TTL or partial indexes — duplicate phone numbers become possible.
5. **`npm run build` runs `tsc`.** A type error fails the image build. Commit a `package-lock.json` so builds are reproducible.

## Common errors & fixes

| Error | Cause → fix |
|---|---|
| `uvicorn==x not found` / motor↔pymongo conflict | Python 3.8 — keep the RANGE pins in `requirements.txt`, never exact latest |
| `TypeError: 'type' object is not subscriptable` | Py3.8 → use `typing.List` (already fixed in config.py) |
| `npm.ps1 cannot be loaded` | PowerShell policy → use `npm.cmd` |
| health says `disconnected` | Mongo not running — expected until Module 2 starts it |
| `409 phone exists` | expected — login instead; seed number already in DB |
| `422 roles admin` | by design — request driver/passenger only |
| `401 wrong code / 429 locked / 410 expired` | request fresh code; 5 tries max; 10-min TTL |
| `SyntaxError typing import` | Py3.8 needs `from typing import …` (fixed in deps.py) |
| `localStorage token XSS` | demo-acceptable; hardening = HttpOnly cookies + short expiry + refresh rotation |
| `routed:false` preview | OSRM demo down/rate-limited — straight-line fallback draws; save still works, refresh later |
| Nominatim empty results | <3 chars ignored; viewbox biases BLR — clear it for other cities (code comment) |
| Leaflet blank div | CDN blocked — check network; component fails silent (form still submits) |
| `from typing Dict` SyntaxError | Py3.8 needs `import` (fixed in routing.py — same lesson as Modules 1/3) |
| `502 on refresh` | routing unreachable — retry; trip keeps old geometry |
| `match` missing on a hit | only `/search/rides` attaches it; `/trips/*` doesn't |
| overlap much lower than expected | route wiggle: % is route-share, not crow-flies share |
| pair looks shareable but score 0 | check `excluded` reasons — pickup > max, wrong direction, or overlap < min |
| `rule-fallback` in `/rank/info` | artifact missing — run the two training commands from the repo root |
| `dataset not found` from train | run `make_dataset.py` first; pass `--csv` only for custom paths |
| blended ties | rule score is the deterministic tiebreak — identical geometries rank identically |
| `weights` length ≠ 4 | retrain; the loader rejects malformed artifacts and falls back safely |
| `NEXT_PUBLIC_*` seems not to change at runtime | It is inlined at build time — rebuild the image |
| `search-with-detour` returns empty | detour gates too tight (max detour 3 km, max extra 10 min, max pickup 3 km, min overlap) — relax knobs or check route reachability; confirm trip is `published` with free seats |
| `detour_km` higher than expected | route wiggle — detour is route-following distance, not crow-flies; OSRM fallback to haversine flags `estimated:true` |
| `estimated:true` on detour result | OSRM unavailable/rate-limited — haversine straight-line fallback used; save still works, refresh later for real routing |

## Contributing & commit conventions

### Code quality gates

- Run `npm run typecheck` and `python -m pytest -q` before opening a pull request.
- TypeScript: `npx tsc --noEmit` must pass.
- Python: `pytest -q` must pass with no new failures.

### Commit message convention

```
<type>(<scope>): <subject>

# Types
# feat — new feature or module
# fix — bug fix
# docs — documentation only
# style — formatting, missing semi colons, etc.
# refactor — restructuring code without behavior changes
# test — adding missing tests
# chore — build/auxiliary changes

# Examples
feat(matching): route-overlap projection + explainable match scoring
fix(auth): 409 phone-exists error message typo
docs(readme): add detailed module roadmap table
refactor(ranker): consolidate feature extraction logic
```

### Conventional Commits + per-module notes

- Each module's `docs/module-XX-*.md` should be updated when corresponding code changes are merged.
- The 9-part template in each doc file should remain consistent for SRS/final report generation.
- Never commit real secrets; use `.env.example` / `.env.local` templates only.
- Run `python -m pytest -q` locally before committing; the CI suite runs the full 121-test battery.

### Pull-request checklist

| # | Check | Command |
|---|-------|---------|
| 1 | TypeScript typecheck passes | `cd frontend && npm run typecheck` |
| 2 | Python tests pass | `cd backend && python -m pytest -q` |
| 3 | Lint passes | `cd frontend && npm run lint` |
| 4 | Module docs updated | Edit `docs/module-XX-*.md` for any module change |
| 5 | Conventional commit | `feat(scope): subject` per convention above |
| 6 | No secrets committed | `.env`, `.env.prod`, `.env.local` are gitignored |

### Branch naming

- `feat/<module>-<short-description>` — e.g. `feat/18-safety-alert-resolution`
- `fix/<module>-<short-description>` — e.g. `fix/3-auth-otp-expiry`
- `docs/<module>-<short-description>` — e.g. `docs/10-pickup-examples`

### Module docs index

Each of the 25 modules has a self-documenting `docs/module-XX-*.md` following a 9-part template (Concept / why, Prerequisites, DB changes + endpoints, Code map, Integration, Run + test, Common errors, Commit message, SRS/report notes).

| Module | Doc file | Focus |
|--------|----------|-------|
| 1 | `docs/module-01-setup.md` | Project scaffold, repo layout, `.env` contract |
| 2 | `docs/module-02-db-design.md` | MongoDB schema, validators, 19 indexes |
| 3 | `docs/module-03-auth.md` | Phone OTP login, JWT, refresh tokens, role model |
| 4 | `docs/module-04-profile.md` | User profile CRUD, avatar, preferences |
| 5 | `docs/module-05-vehicles.md` | Vehicle registration, verification, plate uniqueness |
| 6 | `docs/module-06-trips.md` | Trip publish / update / cancel, route geometry |
| 7 | `docs/module-07-maps.md` | OSRM routing, Nominatim geocoding, Leaflet map |
| 8 | `docs/module-08-search.md` | Trip search, filters, corridor matching |
| 9 | `docs/module-09-matching.md` | Route-aware matching engine, overlap projection |
| 10 | `docs/module-10-pickup-optimization.md` | Minimum-detour pickup, 8-step optimiser |
| 11 | `docs/module-11-bookings.md` | Booking lifecycle, match scoring |
| 12 | `docs/module-12-cost.md` | Fuel cost engine, split policies |
| 13 | `docs/module-13-segments.md` | Route segments, stop definitions |
| 14 | `docs/module-14-advance-booking.md` | Advance booking (30-day horizon) |
| 15 | `docs/module-15-recurring.md` | Recurring ride series, horizon limits |
| 16 | `docs/module-16-ai-ranking.md` | AI ride re-ranker, XGBoost weights |
| 17 | `docs/module-17-tracking.md` | Live GPS tracking, 30-day TTL, ETA |
| 18 | `docs/module-18-safety.md` | Safety alerts: speeding, deviation, SOS |
| 19 | `docs/module-19-completion.md` | Ride completion, safety summary |
| 20 | `docs/module-20-streaming.md` | WebSocket live stream hub, admin fleet view |
| 21 | `docs/module-21-admin.md` | Admin console, stats, suspensions, roles |
| 22 | `docs/module-22-ratings.md` | Ratings & reviews, aggregate card |
| 23 | `docs/module-23-notifications.md` | In-app feed, dedupe, emit() hook |
| 24 | `docs/module-24-analytics.md` | Usage analytics, reports |
| 25 | `docs/module-25-deploy.md` | Production guard, Docker, health probes |

---

## Database & Collections (Module 2)

VoltRide uses **MongoDB** (async Motor driver) with **11 collections**, GeoJSON `[lng, lat]` coordinates everywhere, and UTC timestamps (`depart_at`, `recorded_at`, `created_at`). Validators live in `database/schemas/*.json` (`$jsonSchema`) and indexes are defined in both `database/indexes/*.js` (mongosh) and `backend/app/core/indexes.py` (Python mirror) so `init_db.py` and the runtime never drift.

### Entity relationship diagram

```text
users ──< vehicles (owner_id)
  │         │
  │         └── trips (driver_id, vehicle_id)
  │                 ├── bookings (trip_id, passenger_id)
  │                 ├── segments (trip_id, seq)
  │                 ├── locations (trip_id, trip-scoped GPS only)
  │                 └── safety_alerts (trip_id, opt booking_id)
```

### Collection reference

| Collection | One document is… | Geo fields | Key indexes | TTL |
|---|---|---|---|---|
| `users` | A person; `roles[]` = `driver`/`passenger`/`admin` | — | unique `phone`, sparse `email` | — |
| `vehicles` | A driver's car, verified before trips | — | unique `plate_no` | — |
| `trips` | One driver drive, source → destination + route | `source.point`, `dest.point`, `route_geometry` (LineString) | 2dsphere ×3, `(status, depart_at)` | — |
| `bookings` | One passenger request on a trip | `pickup.point`, `dropoff.point` | `(trip_id, status)` | — |
| `segments` | One leg between stops (Module 13) | `from`/`to` points | unique `(trip_id, seq)` | — |
| `locations` | One GPS ping, active trips only | `point` | 2dsphere | **30 days** |
| `safety_alerts` | SOS / speeding / deviation event | `point` (optional) | `(trip_id, created_at)` | — |
| `phone_otps` | OTP challenge for phone verification | — | `(phone, created_at)` + TTL | 10 min |
| `recurring_groups` | Recurring ride series definition (Module 15) | — | — | — |
| `ratings` | Post-trip ride rating (Module 22) | — | — | — |
| `notifications` | In-app / push notifications (Module 23) | — | — | — |

### Index summary (19 total)

Defined in `backend/app/core/indexes.py` and mirrored in `database/indexes/01-indexes.mongosh.js` plus per-module index files (`02-auth`, `03-recurring`, `04-ratings`, `05-notifications`). Key groups:

- **Geospatial**: `2dsphere` on `trips.source.point`, `trips.dest.point`, `trips.route_geometry`, `locations.point`.
- **Compound unique**: `users.phone`, `vehicles.plate_no`, `segments.(trip_id, seq)`.
- **Query support**: `bookings.(trip_id, status)`, `trips.(status, depart_at)`, `safety_alerts.(trip_id, created_at)`.
- **TTL**: `locations` (30 days), `phone_otps` (10 minutes).

### Initializing the database

```powershell
cd backend
copy .env.example .env
python init_db.py
# Output: created users / validated vehicles / … / indexes ensured: 19 / DB ready: vehicle_sharing_dev
```

`init_db.py` is **idempotent** — re-running is safe. It calls `collMod` on existing collections and `create_collection` on missing ones, then ensures all indexes.

### Seed data

```powershell
python seed.py        # demo accounts + week of trip history
python seed_demo.py   # focused demo dataset
python seed_admin.py  # admin bootstrap account
```

Seed scripts are **dev-only** and must never run against production.

---

## Full API Reference

**Base URL:** `http://localhost:8000/api/v1`  
**Interactive docs:** `GET /docs` (Swagger UI) and `GET /redoc`  
All mutating endpoints require `Authorization: Bearer <access_token>` unless noted.

### Health / ready / version probes

| Endpoint | Auth | Description | Example response |
|---|---|---|---|
| `GET /health` | No | Always 200 while process is up | `{"status":"ok","service":"Intelligent Vehicle Sharing API","db":"disconnected","routing_provider":"osrm"}` |
| `GET /ready` | No | 200 only when Mongo answers | `{"ready":true}` or `{"ready":false,"reason":"db disconnected"}` |
| `GET /version` | No | Git SHA, app env, Python version | `{"git_sha":"abc123","app_env":"development","python_version":"3.8.10"}` |

```powershell
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/ready
curl http://localhost:8000/api/v1/version
```

### Authentication (`/auth/`)

| Method | Endpoint | Description | Example request | Example response |
|---|---|---|---|---|
| `POST` | `/auth/register` | Register new user | `{"phone":"+919876543210","password":"secret123","full_name":"Ravi Kumar","roles":["passenger","driver"]}` | `201` + `{access_token, user}` |
| `POST` | `/auth/login` | Login | `{"phone":"+919876543210","password":"secret123"}` | `{access_token, user}` |
| `POST` | `/auth/otp/request` | Request OTP (dev shows code) | `{"phone":"+919876543210"}` | `{code, masked_phone}` |
| `POST` | `/auth/otp/verify` | Verify OTP | `{"phone":"+919876543210","code":"123456"}` | `{phone_verified:true, success}` |
| `GET` | `/auth/me` | Current user profile | Header: `Authorization: Bearer <token>` | `{user object}` |
| `POST` | `/auth/logout` | Stateless logout | Header: `Authorization: Bearer <token>` | `{success:true}` |

```powershell
# Register
curl -X POST http://localhost:8000/api/v1/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"phone\":\"+919876543210\",\"password\":\"secret123\",\"full_name\":\"Ravi Kumar\",\"roles\":[\"passenger\",\"driver\"]}"

# Login
curl -X POST http://localhost:8000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"phone\":\"+919876543210\",\"password\":\"secret123\"}"
```

### Geo / routing (`/geo/`)

| Method | Endpoint | Description | Example request | Example response |
|---|---|---|---|---|
| `GET` | `/geo/search?q=` | Fuzzy place search (min 3 chars) | `?q=koramangala` | `[{name, latitude, longitude, score}]` |
| `GET` | `/geo/reverse` | Reverse geocode | `?lat=12.93&lng=77.61` | `"Koramangala, Bengaluru"` |
| `POST` | `/geo/route` | Preview route between two places | `{"src":"Indiranagar","dst":"Koramangala"}` | `{routed, distance_km, duration_min, geometry}` |

### Trips (`/trips/`)

| Method | Endpoint | Description | Example request | Example response |
|---|---|---|---|---|
| `GET` | `/trips` | List trips with filters | `?from=Indiranagar&to=Koramangala` | Paginated trip summaries |
| `POST` | `/trips` | Create trip (driver) | `{"origin":"place_id","destination":"place_id","depart_at":"2026-01-15T08:00:00Z","seats":3}` | Created trip `{id, route_geometry, distance_km, duration_min, status}` |
| `GET` | `/trips/{trip_id}` | Get trip by ID | — | Full trip object |
| `GET` | `/trips/mine` | Current user's trips | Auth header | List of user's trips |

### Search / matching (`/search/`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/search/rides` | Search available rides with `max_pickup_km` (default 3), `max_detour_km` (default 5), `min_overlap_pct` (default 20), `include_excluded` (default false) |

### Minimum-detour search (`/rides/`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/rides/search-with-detour` | 8-step detour optimiser over every published trip that day; returns feasible matches with pickup/drop points, detour km, extra time, overlap %, cost contribution |

**Request body:**
```json
{
  "source": {"lat": 12.93, "lng": 77.61, "address": "Indiranagar, Bengaluru"},
  "destination": {"lat": 12.91, "lng": 77.64, "address": "Koramangala, Bengaluru"},
  "date": "2026-01-15",
  "time": "08:00",
  "seats": 1
}
```

**Response (per result):** `trip_id`, `driver_name`, `vehicle {make, model, plate_no, fuel_type, mileage_kmpl}`, `seats_available`, `departure_time`, `pickup_point {lat, lng, address}`, `drop_point {lat, lng, address}`, `walk_distance_km`, `detour_km`, `extra_time_min`, `passenger_distance_km`, `estimated_contribution`, `estimated`, `route_overlap_percent`, `driver_route_polyline`, `passenger_segment_polyline`.

### Bookings (`/bookings/`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/bookings` | Create booking from match snapshot (`ai_score`, `ai_model`, `match_explain`) → `201` + `{id, status, match_score, ai_score}` |
| `GET` | `/bookings` | List bookings (auth) |
| `GET` | `/bookings/{booking_id}` | Booking details |

### Vehicles (`/vehicles/`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/vehicles` | Register vehicle: `plate` (unique), `verified`, `seating_capacity`, `fuel_type`, `mileage_kmpl` |
| `GET` | `/vehicles` | List vehicles |

### Profile (`/profiles/`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/profiles/me` | Current profile (auth) |
| `PATCH` | `/profiles/me` | Update `full_name`, `phone`, `roles` |

### Cost (`/cost/`) — Module 12

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/cost/estimate` | Price a ride share: distance, time, mileage, fuel price, occupant count, `COST_SPLIT_POLICY` |
| `POST` | `/cost/contribution` | Detour fuel contribution for a passenger |

### Segments (`/segments/`) — Module 13

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/segments/{trip_id}` | Trip legs (from/to stops) |
| `POST` | `/segments` | Add a stop/segment to a trip |

### Recurring rides (`/recurring/`) — Modules 14–15

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/recurring` | Define a recurring series (`ADVANCE_MAX_DAYS=30`, `RECURRING_HORIZON_DAYS=21`) |
| `GET` | `/recurring` | List upcoming instances |

### Ratings (`/ratings/`) — Module 22

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/ratings` | Rate a completed ride (1–5 stars) |
| `GET` | `/ratings/{trip_id}` | Trip ratings |

### Notifications (`/notifications/`) — Module 23

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/notifications` | User's notifications |
| `PATCH` | `/notifications/{id}/read` | Mark as read |

### Analytics (`/analytics/`) — Module 24

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/analytics/stats` | Platform-wide aggregates |
| `GET` | `/analytics/rides` | Ride volume over time |

### Tracking (`/tracking/`) — Module 17

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/tracking/fix` | Submit GPS fix (driver, active trip only) |
| `GET` | `/tracking/trail/{trip_id}` | Recent GPS trail |

### Safety (`/safety/`) — Module 18

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/safety/alert` | Raise SOS / speeding / deviation event |
| `GET` | `/safety/alerts/{trip_id}` | Trip safety events |

### Live / streaming (`/stream/`) — Module 20

| Method | Endpoint | Description |
|---|---|---|
| `WS` | `/stream/trips/{trip_id}` | WebSocket live tracking fan-out per trip |

### Admin (`/db/`, `/admin/`) — Module 21

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/db/stats` | Database statistics `{trips, users, vehicles, bookings, …}` |
| `GET` | `/db/schema/{collection}` | JSON schema validator for a collection |
| `POST` | `/db/init` | Initialize database (`created: ×11, indexes ensured: 19`) |

---

## WebSocket / Live Tracking Protocol (Module 20)

VoltRide pushes live GPS fixes to every watcher of a trip through an **in-process WebSocket hub** (`backend/app/services/hub.py`, class `LiveHub`, singleton `hub`).

### Connection flow

1. Passenger opens a trip's live page → frontend opens `WS ws://<host>/api/v1/stream/trips/{trip_id}` (scheme derived from `NEXT_PUBLIC_API_URL`: `http→ws`, `https→wss`).
2. Server calls `hub.subscribe(trip_id, ws)` → returns current subscriber count.
3. On each driver GPS fix, the tracking route calls `hub.broadcast(trip_id, payload)` → every subscriber receives the JSON frame immediately.
4. On disconnect / error → `hub.unsubscribe(trip_id, ws)`.

### Message schema

Every broadcast payload is normalised by `json_safe()` so `datetime` → ISO string and `ObjectId` → string. A typical frame:

```json
{
  "trip_id": "64f…",
  "lat": 12.9345,
  "lng": 77.6123,
  "speed_kmh": 34.2,
  "recorded_at": "2026-01-15T08:15:30Z",
  "eta_min": 12
}
```

### Heartbeat & failure discipline

- `HEARTBEAT_S = 5.0` — subscribers re-read from DB when nothing is pushed (safety net for changes arriving over HTTP or another process).
- A socket that raises on `send_json` is **dropped** from the registry (dead connections never poison a broadcast); the failure reason is stored in `hub.last_error`.
- `broadcast()` never raises — a push failure cannot fail the driver's ping that triggered it.

### Scope & scale-out

The registry is **in-process**, correct for a single uvicorn worker (the MVP deployment). Scaling to multiple workers/replicas requires a shared bus (Redis pub/sub or NATS) behind `broadcast()` — no caller changes needed.

**Reverse-proxy note:** The proxy must forward the `Upgrade` header for `WS /api/v1/stream/trips/{id}`, or live tracking silently degrades.

### Hub stats (admin console)

```json
{
  "trips": 3,
  "sockets": 5,
  "pushed": 1247,
  "dropped": 2,
  "last_error": null,
  "scope": "in-process (single worker); Redis pub/sub is the scale-out path"
}

---

## ML / AI Ride Ranking — Model Card (Module 16)

### Purpose

After hard gates (pickup distance, direction, overlap) filter candidates, an AI model re-ranks feasible matches. The final score is a **blend**:

```
blended = 0.5 × rule_score + 0.5 × ai_score
```

The AI never overrides hard constraints — a gated-out ride always gets `ai_score=None`.

### Feature set (4 normalised signals, all in [0, 1], higher = better)

Defined identically in `ml/README.py` and `backend/app/services/ranker.py` so training and serving cannot drift:

| Feature | Formula | Meaning |
|---|---|---|
| `overlap01` | `overlap_pct / 100` | Route share the rider actually uses |
| `pickup01` | `max(0, 1 − pickup_km / max_pickup_km)` | Walk distance to pickup |
| `dropoff01` | `max(0, 1 − dropoff_km / max_detour_km)` | Drop deviation from driver route |
| `time01` | `1 − min(1, time_diff_min / 120)` | Departure-time proximity (0.6 when unspecified) |

### Training pipeline

```
ml/make_dataset.py   →  synthetic 4000-row CSV  →  ml/train_ranker.py  →  ml/artifacts/ranker.json
```

1. `make_dataset.py` generates a labelled synthetic dataset.
2. `train_ranker.py` trains logistic regression / random forest / XGBoost and exports `ranker.json` (plain JSON weights + model card).
3. The backend runtime **never imports** `pandas`/`scikit-learn`/`xgboost` — it reads `ranker.json` via a stdlib-only ranker service (`backend/app/services/ranker.py`).

### Artifact format (`ml/artifacts/ranker.json`)

```json
{
  "model": "logistic_regression",
  "weights": {"overlap01": 0.42, "pickup01": 0.28, "dropoff01": 0.18, "time01": 0.12},
  "bias": 0.05,
  "features": ["overlap01","pickup01","dropoff01","time01"],
  "trained_at": "2026-01-15T…",
  "version": "1.0"
}
```

### Training commands (repo root)

```powershell
cd ml
pip install -r requirements.txt
python make_dataset.py
python train_ranker.py
```

If the artifact is missing, the API falls back to `rule-fallback` scoring in `/rank/info`.

---

## Cost Calculation Engine (Module 12)

### Pricing inputs

| Source | Values |
|---|---|
| Fuel prices (₹/unit) | Petrol 104.5, Diesel 95.0, CNG 89.0, EV 12.0 (kWh-equiv), Hybrid 95.0 |
| Default mileage | 15 km/l |
| Cost policy | `split_equal` / `EQUAL_SPLIT` / `FULL_PASSENGER_SHARE` |
| Detour cost inclusion | `INCLUDE_DETOUR_COST=false` (default) |

### Contribution formula

`compute_detour_contribution` (`backend/app/modules/cost/calculator.py`) prices each share using:

```
contribution = f(route_distance_km, travel_time_min, mileage_kmpl, fuel_price, occupant_count, cost_split_policy, include_detour_cost)
```

The passenger pays only for the **shared segment** (`cumulative(Q) − cumulative(P)`), not the driver's whole route.

### Environment knobs (`.env`)

| Knob | Default | Meaning |
|---|---|---|
| `FUEL_PRICE_PETROL` | `104.5` | ₹ per litre |
| `FUEL_PRICE_DIESEL` | `95.0` | ₹ per litre |
| `FUEL_PRICE_CNG` | `89.0` | ₹ per kg |
| `FUEL_PRICE_EV` | `12.0` | ₹ per kWh-equivalent |
| `DEFAULT_MILEAGE_KMPL` | `15.0` | km per litre |
| `DEFAULT_COST_POLICY` | `split_equal` | equal vs full passenger share |
| `COST_SPLIT_POLICY` | `EQUAL_SPLIT` | `EQUAL_SPLIT` / `FULL_PASSENGER_SHARE` |
| `INCLUDE_DETOUR_COST` | `false` | add detour fuel to passenger share |

---

## Security & Production Hardening (Module 25)

### Startup production guard

When `APP_ENV=production`, `backend/app/main.py` calls `validate_production()` and **refuses to boot** if any check fails:

| Check | Pass condition |
|---|---|
| JWT secret | Not the shipped dev value `change-me-in-dev-only-min-32-chars` |
| JWT length | ≥ 32 characters |
| CORS origins | Non-empty list |
| CORS scheme | No plain `http://` origins except `localhost` / `127.0.0.1` |
| Mongo DB name | Non-empty |

In development the guard is a no-op, so tests and local work are unaffected.

### Authentication security

- JWT signed with `python-jose` (HS256), expiry `JWT_EXPIRE_MINUTES` (default 10080 min = 7 days).
- Password hashing with `passlib[bcrypt]`.
- Phone OTP: 5 attempts max, 10-minute TTL, code displayed on screen in dev mode.
- `python-jose[cryptography]==3.3.0` pinned to avoid drift.

### CORS

Locked to `settings.cors_origin_list` (parsed from comma-separated `CORS_ORIGINS`). Credentials allowed.

### Recommendations for production

1. Rotate `JWT_SECRET` to a 32+ random character value.
2. Use `https://` CORS origins only.
3. Set `NEXT_PUBLIC_API_URL` at **build time** (it is inlined into the Next.js bundle).
4. Consider HttpOnly cookies + short access-token expiry + refresh rotation instead of `localStorage` (current demo-acceptable pattern is XSS-exposed).

---

## Minimum-Detour Search — Algorithm Detail (Module 10)

`POST /api/v1/rides/search-with-detour` runs an **8-step route-snapping / corridor-matching optimiser** over every published trip for the day:

| Step | Action | Gate |
|---|---|---|
| 1 | Fetch driver route polyline from OSRM (haversine fallback, `estimated:true`) | — |
| 2 | Snap passenger source onto polyline → pickup point `P` | Walk ≤ `MAX_PICKUP_DISTANCE_KM` (3 km) |
| 3 | Project passenger destination → drop point `Q` | — |
| 4 | Direction gate | `Q` must be after `P` (forward) |
| 5 | Destination tolerance | `Q` within `DEST_TOLERANCE_KM` (2 km) of driver destination |
| 6 | Passenger distance | `cumulative(Q) − cumulative(P)` > 0 |
| 7 | Feasibility limits | detour ≤ 3 km, extra time ≤ 10 min, pickup walk ≤ 3 km |
| 8 | Cost contribution | `compute_detour_contribution` prices the share |

### Response fields per match

`trip_id`, `driver_name`, `vehicle`, `seats_available`, `departure_time`, `pickup_point`, `drop_point`, `walk_distance_km`, `detour_km`, `extra_time_min`, `passenger_distance_km`, `estimated_contribution`, `estimated`, `route_overlap_percent`, `driver_route_polyline`, `passenger_segment_polyline`.

---

## Monitoring & Observability

| Probe | Endpoint | Condition |
|---|---|---|
| Liveness | `GET /health` | Always 200 while process up (Mongo may be down) |
| Readiness | `GET /ready` | 200 only when Mongo answers |
| Version | `GET /version` | Git SHA, env, Python version |
| Hub stats | Admin console | `hub.stats()` — trips, sockets, pushed, dropped, last_error |
| DB stats | `GET /db/stats` | Counts per collection |

### TTL & data retention

- `locations` (GPS pings): **30-day TTL**, active trips only — privacy-by-design.
- `phone_otps`: **10-minute TTL**.
- No permanent location history is stored.

---

## Backup & Restore

### MongoDB dump / restore

```powershell
# Backup
mongodump --uri="mongodb://localhost:27017/vehicle_sharing_dev" --out=./backup/$(Get-Date -Format "yyyyMMdd")

# Restore
mongorestore --uri="mongodb://localhost:27017/vehicle_sharing_dev" ./backup/20260115/vehicle_sharing_dev
```

### Idempotent re-init

```powershell
cd backend
python init_db.py   # safe to rerun; creates missing collections, collMods existing, ensures indexes
```

### Seed data separation

Seed scripts (`seed.py`, `seed_demo.py`, `seed_admin.py`) insert **demo accounts and trip history only** — never run against production.

---

## Frontend: Next.js App Router vs Static HTML/CSS Port

The repository contains **two frontend representations**:

| Variant | Location | Stack | Build step |
|---|---|---|---|
| Next.js App Router (primary) | `frontend/app/`, `frontend/components/`, `frontend/lib/` | Next.js 14, React 18, TypeScript, Tailwind | `npm run build` |
| Static HTML/CSS port (separate docs) | `frontend/*.html` | Plain HTML + CSS + JS | None |

The root README documents the Next.js monorepo. The static port is documented in `frontend/README.md`. They share the same backend API at `http://localhost:8000/api/v1`.

### Key Next.js routes

`/`, `/login`, `/register`, `/verify`, `/me`, `/trips`, `/garage`, `/profile`, `/requests`, `/bookings`, `/admin`, `/not-found`, `/error`.

### Key UI primitives (`components/ui/`)

`Button`, `Card`, `Input`, `Badge`, `Avatar`, `Separator`, `TripCard`, `RideCard`, `MatchCard`, `DetourRideCard`, `VehicleTrackingCard`, `StatusPill`, `ThemeToggle`, `LiveTrack`, `RouteMap`, `PlacePicker`, `PickupChooser`, `StarPicker`, `Stars`, `CollectionCard`, `FeatureGrid`, `LiveCorridorMap`, `SafetyBanner`, `RateRideCard`, `TripCostCard`, `TrustSignals`, `VehicleArt`, `VehicleCard`, `VehicleForm`, `BookingPanel`, `MatchPipeline`, `NotificationBell`.

### Design tokens

- Dark background: Indigo `#0B1030` / accent `#7B77FF`
- Light accent: Lime `#C6FF4A`
- Display type: Sora; Body type: Inter
- Theme stored via `data-theme` on `<html>`, persisted in `localStorage`, respects `prefers-reduced-motion`.

---

## FAQ

| Question | Answer |
|---|---|
| **Does `NEXT_PUBLIC_*` change at runtime?** | No — it is inlined at Next.js **build time**. Rebuild the image after changing it. |
| **Why single uvicorn worker?** | Module 20's WebSocket hub is an in-process registry. `--workers 2` gives each worker its own watchers; half the clients would stop receiving frames. Scale-out needs Redis/NATS behind `hub.broadcast()`. |
| **OSRM is down / rate-limited — what happens?** | Haversine straight-line fallback is used; detour results are flagged `estimated:true`. Save still works; refresh later for real routing. |
| **`npm.ps1 cannot be loaded`** | PowerShell execution policy blocks `npm.ps1`. Use `npm.cmd` or run `start-dev.ps1` with `-ExecutionPolicy Bypass`. |
| **`409 phone exists` on register** | Expected — that phone already has an account; log in instead. |
| **`422 roles admin`** | By design — request `driver` or `passenger` only; admin is bootstrapped via `seed_admin.py`. |
| **`detour_km` higher than expected** | Detour is route-following distance (OSRM), not crow-flies. Route wiggle inflates it. |
| **`rule-fallback` in `/rank/info`** | ML artifact missing — run `ml/make_dataset.py` then `ml/train_ranker.py` from the repo root. |
| **Why `python init_db.py` is required** | Without it there are no unique, geo, TTL, or partial indexes — duplicate phone numbers become possible. |

---

## Changelog

| Version | Date | Changes |
|---|---|---|
| `v1.0.0` | 2026-01-15 | 25/25 modules complete · 121 tests passing · 92 API routes · 11 MongoDB collections · minimum-detour pickup optimisation · AI ride ranking · live WebSocket tracking · production hardening guard |
| `v1.1.0` | 2026-11-19 | Detailed README pass — GitHub badges, Quick Start (no-Docker) section, complete Database schema table, frontend env vars, expanded API reference (Admin, Ratings, Notifications, Segments, Safety, Fuel, Cost, Recurring, Advance, Completion, Streaming, Health probes), Module docs index table, expanded Contributing PR checklist & branch naming, consolidated FAQ |
| `v1.2.0` | 2026-11-22 | **Driver & Passenger Workspace Expansion · Route Selection & Fair Cost Sharing**: <br>• **Driver Workspace**: 3 hosting modes (Live Trips leaving now, 30-day Monthly Pass, Long Trips 1-week advance) · Module 26 multi-route selection with OSRM alternatives + bypass fallback · real-time fuel & itemized other expenses (Tolls, Parking, Permits) calculator with per-seat breakdown · decoupled route selection (no auto-host on click) and dedicated "Host & Save Draft" action. <br>• **Passenger Workspace**: 1-tap Live GPS Source & Destination picking with reverse geocoding · corridor-aware availability search · "Seat Over (Sold Out)" search badge for fully booked rides · dynamic split-equal cost sharing with previous vs. present fare reduction history (`~~₹1,250~~ → ₹834`) and savings badge · flexible cancellation (requested, accepted, confirmed) with automatic seat and fare re-splitting · destination reached completion and 1–5 star driver rating workflow. |
