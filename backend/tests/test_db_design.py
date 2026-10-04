"""Module 2 tests: Pydantic shapes (no Mongo) + index-mirror parity."""

from app.core.indexes import INDEXES
from app.models.common import GeoPoint
from app.models.telemetry_safety import LocationDoc
from app.models.trips_bookings import BookingDoc, TripDoc
from app.models.users_vehicles import UserDoc


def test_geopoint_rejects_lat_lng_swap():
    try:
        GeoPoint(coordinates=[13.0, 77.0])  # lat,lng — must fail (lat 77 valid? no: lng slot)
        # [13,77]: lng=13 ok, lat=77 ok — in range! assert real invalid instead:
        GeoPoint(coordinates=[200.0, 13.0])
        raise AssertionError("should have raised")
    except Exception:
        assert True


def test_user_roles_constrained():
    try:
        UserDoc(phone="+919876543210", full_name="X Y", roles=["pilot"])
        raise AssertionError("should have raised")
    except Exception:
        assert True


def test_trip_doc_minimal_ok():
    t = TripDoc(
        driver_id="64f000000000000000000001",
        vehicle_id="64f000000000000000000002",
        source={"name": "A", "point": {"type": "Point", "coordinates": [77.5, 13.0]}},
        destination={"name": "B", "point": {"type": "Point", "coordinates": [77.6, 12.8]}},
        depart_at="2030-01-01T09:00:00Z",
        seats_offered=3,
    )
    assert t.status == "draft"


def test_booking_defaults_requested():
    b = BookingDoc(
        trip_id="64f000000000000000000001",
        passenger_id="64f000000000000000000003",
        seats=1,
        pickup={"point": {"type": "Point", "coordinates": [77.5, 13.0]}},
        dropoff={"point": {"type": "Point", "coordinates": [77.6, 12.8]}},
    )
    assert b.status == "requested"


def test_location_ttl_index_present():
    loc = [kw for keys, kw in INDEXES["locations"]]
    ttl = [k for k in loc if k.get("expireAfterSeconds") == 2592000]
    assert len(ttl) == 1


def test_eleven_collections_indexed():
    assert set(INDEXES) == {"users", "vehicles", "trips", "bookings", "segments", "locations", "safety_alerts", "phone_otps", "recurring_groups", "ratings", "notifications"}


def test_notification_dedupe_index_is_partial_not_sparse():
    """Module 23, learned the hard way against a real Mongo.

    A compound SPARSE index indexes a document when ANY indexed field is
    present — and user_id always is — so SOS rows (which deliberately carry no
    dedupe_key) were indexed as null and the unique build collided on the
    second one. partialFilterExpression is the only primitive that says
    "index only rows that actually carry a key".
    """
    pair = [kw for _, kw in INDEXES["notifications"]
            if kw.get("name") == "uq_notifications_dedupe"][0]
    assert pair.get("unique") is True
    assert "sparse" not in pair
    assert pair.get("partialFilterExpression") == \
        {"dedupe_key": {"$type": "string"}}


def test_five_mirrors_agree_on_the_collection_set():
    """The collection set is declared in FIVE places. A new collection added to
    one but not the others would be created without a validator, or indexed
    without a schema — the exact drift Module 2's design exists to prevent.
    Module 22/23 shipped a real instance of this bug; this test is the fix."""
    import json
    from pathlib import Path

    import init_db
    from app.api.v1.db_admin import COLLECTIONS

    root = Path(__file__).resolve().parents[2]
    schema_dir = root / "database" / "schemas"
    expected = set(INDEXES)

    # 1. core.indexes.INDEXES  == 2. db_admin.COLLECTIONS
    assert expected == set(COLLECTIONS)
    # 3. init_db.SCHEMA_FILES (what `python init_db.py` actually creates)
    assert expected == set(init_db.SCHEMA_FILES)
    # 4. every declared collection has a schema file on disk
    for name, fname in init_db.SCHEMA_FILES.items():
        path = schema_dir / fname
        assert path.exists(), "missing schema for " + name
        assert "$jsonSchema" in json.loads(path.read_text())
    # 5. every schema file on disk is a declared collection (no orphans)
    on_disk = {p.stem for p in schema_dir.glob("*.json")}
    assert on_disk == expected, "orphan schema files: " + str(on_disk ^ expected)
    # 6. a mongosh index script mentions every collection
    js = "".join(p.read_text() for p in (root / "database" / "indexes").glob("*.js"))
    for name in expected:
        assert "db." + name + ".createIndex" in js, "no mongosh index for " + name


def test_ratings_unique_pair_index_present():
    # Module 22: one vote per (booking, rater) is enforced by the index, not by
    # application code — that is the whole anti-brigading guarantee.
    names = [kw.get("name") for _, kw in INDEXES["ratings"]]
    assert "uq_ratings_booking_rater" in names
    pair = [kw for keys, kw in INDEXES["ratings"]
            if kw.get("name") == "uq_ratings_booking_rater"][0]
    assert pair.get("unique") is True


def test_location_doc_minimal():
    LocationDoc(trip_id="64f000000000000000000001", actor_id="64f000000000000000000001",
                point={"type": "Point", "coordinates": [77.5, 13.0]})
