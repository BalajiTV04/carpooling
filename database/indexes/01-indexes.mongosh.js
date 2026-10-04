// Run: mongosh $MONGO_URI/$MONGO_DB database/indexes/01-indexes.mongosh.js
// Mirrors backend/app/core/indexes.py — keep both in sync.
db.users.createIndex({ phone: 1 }, { unique: true, name: "uq_users_phone" });
db.users.createIndex({ email: 1 }, { unique: true, sparse: true, name: "uq_users_email" });
db.users.createIndex({ roles: 1, status: 1 }, { name: "ix_users_roles_status" });
db.vehicles.createIndex({ plate_no: 1 }, { unique: true, name: "uq_vehicles_plate" });
db.vehicles.createIndex({ owner_id: 1, is_active: 1 }, { name: "ix_vehicles_owner" });
db.trips.createIndex({ "source.point": "2dsphere" }, { name: "geo_trips_source" });
db.trips.createIndex({ "destination.point": "2dsphere" }, { name: "geo_trips_dest" });
db.trips.createIndex({ route_geometry: "2dsphere" }, { name: "geo_trips_route" });
db.trips.createIndex({ status: 1, depart_at: 1 }, { name: "ix_trips_status_depart" });
db.trips.createIndex({ driver_id: 1, depart_at: -1 }, { name: "ix_trips_driver" });
db.bookings.createIndex({ trip_id: 1, status: 1 }, { name: "ix_bookings_trip" });
db.bookings.createIndex({ passenger_id: 1, created_at: -1 }, { name: "ix_bookings_pax" });
db.bookings.createIndex({ "pickup.point": "2dsphere" }, { name: "geo_bookings_pickup" });
db.segments.createIndex({ trip_id: 1, seq: 1 }, { unique: true, name: "uq_segments_trip_seq" });
db.locations.createIndex({ point: "2dsphere" }, { name: "geo_locations_point" });
db.locations.createIndex({ trip_id: 1, recorded_at: -1 }, { name: "ix_locations_trip" });
db.locations.createIndex({ recorded_at: 1 }, { expireAfterSeconds: 2592000, name: "ttl_locations_30d" });
db.safety_alerts.createIndex({ trip_id: 1, created_at: -1 }, { name: "ix_alerts_trip" });
db.safety_alerts.createIndex({ status: 1, type: 1 }, { name: "ix_alerts_admin" });
print("indexes ok");
