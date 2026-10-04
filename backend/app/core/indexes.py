"""Index mirror for backend init. create_index is idempotent: safe to rerun.
Same names as database/indexes/01-indexes.mongosh.js — keep in sync."""
from typing import Any, Dict, List, Tuple

Index = Tuple[List[Tuple[str, Any]], Dict[str, Any]]

INDEXES = {
    "users": [
        ([("phone", 1)], {"unique": True, "name": "uq_users_phone"}),
        ([("email", 1)], {"unique": True, "sparse": True, "name": "uq_users_email"}),
        ([("roles", 1), ("status", 1)], {"name": "ix_users_roles_status"}),
    ],
    "vehicles": [
        ([("plate_no", 1)], {"unique": True, "name": "uq_vehicles_plate"}),
        ([("owner_id", 1), ("is_active", 1)], {"name": "ix_vehicles_owner"}),
    ],
    "trips": [
        ([("source.point", "2dsphere")], {"name": "geo_trips_source"}),
        ([("destination.point", "2dsphere")], {"name": "geo_trips_dest"}),
        ([("route_geometry", "2dsphere")], {"name": "geo_trips_route"}),
        ([("status", 1), ("depart_at", 1)], {"name": "ix_trips_status_depart"}),
        ([("driver_id", 1), ("depart_at", -1)], {"name": "ix_trips_driver"}),
    ],
    "bookings": [
        ([("trip_id", 1), ("status", 1)], {"name": "ix_bookings_trip"}),
        ([("passenger_id", 1), ("created_at", -1)], {"name": "ix_bookings_pax"}),
        ([("pickup.point", "2dsphere")], {"name": "geo_bookings_pickup"}),
    ],
    "segments": [
        ([("trip_id", 1), ("seq", 1)], {"unique": True, "name": "uq_segments_trip_seq"}),
    ],
    "locations": [
        ([("point", "2dsphere")], {"name": "geo_locations_point"}),
        ([("trip_id", 1), ("recorded_at", -1)], {"name": "ix_locations_trip"}),
        ([("recorded_at", 1)], {"expireAfterSeconds": 2592000, "name": "ttl_locations_30d"}),
    ],
    "safety_alerts": [
        ([("trip_id", 1), ("created_at", -1)], {"name": "ix_alerts_trip"}),
        ([("status", 1), ("type", 1)], {"name": "ix_alerts_admin"}),
    ],
    "phone_otps": [
        ([("phone", 1)], {"name": "ix_otps_phone"}),
        ([("expires_at", 1)], {"expireAfterSeconds": 0, "name": "ttl_otps_expiry"}),
    ],
    "recurring_groups": [
        ([("group_id", 1)], {"unique": True, "name": "uq_recurring_group"}),
        ([("driver_id", 1), ("active", 1)], {"name": "ix_recurring_driver"}),
    ],
    # Module 22: the unique pair is the whole anti-brigading rule — one rater,
    # one vote per ride. Re-posting the same booking updates that row.
    "ratings": [
        ([("booking_id", 1), ("rater_id", 1)],
         {"unique": True, "name": "uq_ratings_booking_rater"}),
        ([("target_id", 1), ("created_at", -1)], {"name": "ix_ratings_target"}),
    ],
    # Module 23: the feed is per-user. The dedupe guarantee needs a PARTIAL
    # index, not a sparse one: for a compound index MongoDB indexes a document
    # if ANY of the indexed fields is present, and user_id is always present,
    # so a sparse index would still index SOS rows (no dedupe_key) as null and
    # the build would collide on the second one. partialFilterExpression is the
    # only way to say "index only rows that actually carry a key".
    "notifications": [
        ([("user_id", 1), ("created_at", -1)], {"name": "ix_notifications_user"}),
        ([("user_id", 1), ("read_at", 1)], {"name": "ix_notifications_unread"}),
        ([("user_id", 1), ("dedupe_key", 1)],
         {"unique": True, "name": "uq_notifications_dedupe",
          "partialFilterExpression": {"dedupe_key": {"$type": "string"}}}),
    ],
}


async def ensure_indexes(db) -> List[str]:
    """Create every missing index. Returns list of ensured index names."""
    ensured = []
    for coll_name, defs in INDEXES.items():
        coll = db[coll_name]
        existing = await coll.index_information()
        for keys, kwargs in defs:
            name = kwargs.get("name")
            if name not in existing:
                await coll.create_index(keys, **kwargs)
            ensured.append(name)
    return ensured
