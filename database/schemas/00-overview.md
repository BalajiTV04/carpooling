# Database design — Module 2 (overview)

Seven collections. All coordinates are GeoJSON `[lng, lat]` (never lat,lng).
All times UTC (`depart_at`, `recorded_at`, `created_at`).

```
users ──< vehicles (owner_id)
  │         │
  │         └── trips (driver_id, vehicle_id)
  │                 ├── bookings (trip_id, passenger_id)
  │                 ├── segments (trip_id, seq)
  │                 ├── locations (trip_id, trip-scoped GPS only)
  │                 └── safety_alerts (trip_id, opt booking_id)
```

| Collection | One row is… | Geo fields | Key indexes |
|---|---|---|---|
| users | a person, roles[] = driver/passenger/admin | — | unique phone, sparse email |
| vehicles | a driver's car, verified before trips | — | unique plate_no |
| trips | one driver drive, source→dest + route | source.point, dest.point, route_geometry (LineString) | 2dsphere ×3, (status, depart_at) |
| bookings | one passenger request on a trip | pickup.point, dropoff.point | (trip_id, status) |
| segments | one leg between stops (Module 13) | from/to points | unique (trip_id, seq) |
| locations | one GPS ping, active trips only | point | 2dsphere, TTL 30d |
| safety_alerts | SOS / speed / deviation event | point? | (trip_id, created_at) |

Validators live in `schemas/*.json` ($jsonSchema). Indexes in
`indexes/01-indexes.mongosh.js` + mirrored in
`backend/app/core/indexes.py` so `init_db.py` and the API agree.
Seed data: `seed/seed_dev.py` (1 driver + car + trip, flag-guarded).
