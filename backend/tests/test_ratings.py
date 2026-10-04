"""Module 22 tests: rating eligibility/aggregate rules (pure) + the live flow.

The live test drives a real ride to completion (Module 19) and then exercises
the whole trust layer: pending list -> rate -> re-rate -> public card -> both
refusal paths (stranger, ride not finished) -> the admin console.
"""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.models.rating import RatingIn
from app.services.ratings import (
    MAX_STARS,
    MIN_STARS,
    aggregate,
    clean_comment,
    distribution,
    rateable_rows,
    rating_eligibility,
    validate_stars,
)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def _booking(status="completed", passenger="p1", driver="d1"):
    return {"_id": "b1", "trip_id": "t1", "status": status,
            "passenger_id": passenger, "driver_id": driver, "seats": 1,
            "closed_at": None}


# --------------------------------------------------------------------------
# pure rules
# --------------------------------------------------------------------------

def test_validate_stars_bounds():
    assert validate_stars(1) == {"ok": True, "stars": 1, "reason": None}
    assert validate_stars(5)["stars"] == 5
    assert validate_stars(4.0)["stars"] == 4        # integral float is fine
    for bad in (0, 6, -1, 4.5, "x", None, True):
        v = validate_stars(bad)
        assert v["ok"] is False and v["stars"] is None, bad
    assert "1-5" in validate_stars(9)["reason"]


def test_model_bounds_agree_with_service_constants():
    """Drift guard: Pydantic is the validation boundary, the service is the
    policy — this pins the two to the same 1..5 range."""
    assert (MIN_STARS, MAX_STARS) == (1, 5)
    assert RatingIn(booking_id="b", stars=MAX_STARS).stars == 5
    for bad in (0, 6):
        with pytest.raises(Exception):
            RatingIn(booking_id="b", stars=bad)


def test_clean_comment():
    assert clean_comment(None) is None
    assert clean_comment("   ") is None
    assert clean_comment("  smooth   ride \n ") == "smooth ride"
    assert len(clean_comment("x" * 900)) == 500


def test_eligibility_matrix():
    # 1. not a party -> forbidden (403)
    v = rating_eligibility(_booking(), "stranger")
    assert v["allowed"] is False and v["code"] == "forbidden"

    # 2. party but ride not finished -> unprocessable (422)
    for st in ("requested", "accepted", "confirmed", "cancelled", "rejected"):
        v = rating_eligibility(_booking(status=st), "p1")
        assert v["allowed"] is False and v["code"] == "unprocessable", st
        assert "completed" in v["reason"]

    # 3. completed -> the target is always the OTHER party, never yourself
    assert rating_eligibility(_booking(), "p1")["target_id"] == "d1"
    assert rating_eligibility(_booking(), "d1")["target_id"] == "p1"


def test_aggregate_and_distribution():
    assert aggregate([]) == {"avg": None, "count": 0}
    assert aggregate([{"stars": 4}]) == {"avg": 4.0, "count": 1}
    # 4+5+5 -> 4.67 (rounded, not truncated)
    assert aggregate([{"stars": 4}, {"stars": 5}, {"stars": 5}]) == \
        {"avg": 4.67, "count": 3}
    # junk rows are ignored rather than poisoning the average
    assert aggregate([{"stars": 4}, {"stars": "x"}, {}, {"stars": 99}]) == \
        {"avg": 4.0, "count": 1}
    dist = distribution([{"stars": 5}, {"stars": 5}, {"stars": 1}])
    assert dist == {"1": 1, "2": 0, "3": 0, "4": 0, "5": 2}


def test_rateable_rows_flags_existing_scores():
    rows = rateable_rows(
        [_booking(), _booking(status="confirmed", passenger="p2")],
        "d1",
        {"b1": 4},
    )
    # only the completed one survives, and it remembers the 4 I already gave
    assert len(rows) == 1
    assert rows[0]["my_stars"] == 4 and rows[0]["target_id"] == "p1"
    assert rateable_rows([_booking()], "p1", {})[0]["my_stars"] is None


# --------------------------------------------------------------------------
# live flow
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rating_flow_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax, other = "+919000002201", "+919000002202", "+919000002203"
    for p in (drv, pax, other):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^RateTest"}})
    await db.bookings.delete_many({})
    await db.ratings.delete_many({})

    async with _client() as ac:
        toks = {}
        for p in (drv, pax, other):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Rate " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        for p in (drv, pax, other):
            toks[p] = (await ac.post("/api/v1/auth/login", json={
                "phone": p, "password": "pass1234"})).json()["access_token"]
        drv_id = (await ac.get("/api/v1/auth/me",
                    headers=_h(toks[drv]))).json()["id"]
        pax_id = (await ac.get("/api/v1/auth/me",
                    headers=_h(toks[pax]))).json()["id"]

        depart = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0)
        now = datetime.now(timezone.utc)
        trip_id = str((await db.trips.insert_one({
            "driver_id": ObjectId(drv_id), "vehicle_id": ObjectId(),
            "source": {"name": "RateTest A", "point": {"type": "Point",
                        "coordinates": [77.5946, 13.0358]}},
            "destination": {"name": "RateTest B", "point": {"type": "Point",
                             "coordinates": [77.67, 12.8452]}},
            "route_geometry": {"type": "LineString", "coordinates": [
                [77.5946, 13.0358], [77.62, 13.0],
                [77.65, 12.92], [77.67, 12.8452]]},
            "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
            "seats_offered": 3, "seats_booked": 0, "status": "published",
            "created_at": now, "updated_at": now,
        })).inserted_id)
        booking_id = str((await db.bookings.insert_one({
            "trip_id": ObjectId(trip_id), "passenger_id": ObjectId(pax_id),
            "driver_id": ObjectId(drv_id), "seats": 1, "status": "confirmed",
            "pickup": {"point": {"type": "Point",
                                 "coordinates": [77.5946, 13.0358]}},
            "dropoff": {"point": {"type": "Point",
                                  "coordinates": [77.67, 12.8452]}},
            "created_at": now, "updated_at": now})).inserted_id)

        # 1. a confirmed (not yet completed) ride is NOT ratable
        r = await ac.post("/api/v1/ratings", headers=_h(toks[pax]), json={
            "booking_id": booking_id, "stars": 5})
        assert r.status_code == 422 and "completed" in r.json()["detail"]

        # 2. complete the ride (Module 19) -> both sides have a pending row
        base = "/api/v1/trips/" + trip_id
        assert (await ac.post(base + "/complete",
                headers=_h(toks[drv]))).status_code == 200
        for who, expected_target in ((toks[pax], drv_id), (toks[drv], pax_id)):
            pend = (await ac.get("/api/v1/ratings/pending",
                     headers=_h(who))).json()
            assert pend["count"] == 1 and pend["unrated"] == 1
            row = pend["items"][0]
            assert row["booking_id"] == booking_id
            assert row["target_id"] == expected_target
            assert row["my_stars"] is None
        # a stranger was never on this ride: nothing to rate
        assert (await ac.get("/api/v1/ratings/pending",
                headers=_h(toks[other]))).json()["count"] == 0

        # 3. the stranger cannot rate the parties
        assert (await ac.post("/api/v1/ratings", headers=_h(toks[other]), json={
            "booking_id": booking_id, "stars": 1})).status_code == 403

        # 4. the passenger rates the driver
        r = await ac.post("/api/v1/ratings", headers=_h(toks[pax]), json={
            "booking_id": booking_id, "stars": 5,
            "comment": "  great   driver  "})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["stars"] == 5 and body["comment"] == "great driver"
        assert body["target_id"] == drv_id
        assert body["target_rating_avg"] == 5.0
        assert body["target_rating_count"] == 1

        # 5. re-rating EDITS the score, it never stacks a second vote.
        #    The POST is a full replace of the review (not a patch), so the
        #    comment is cleared when the new payload omits one.
        r = await ac.post("/api/v1/ratings", headers=_h(toks[pax]), json={
            "booking_id": booking_id, "stars": 3})
        assert r.status_code == 200
        assert r.json()["target_rating_count"] == 1
        assert r.json()["target_rating_avg"] == 3.0
        assert r.json()["comment"] is None
        assert await db.ratings.count_documents(
            {"booking_id": ObjectId(booking_id)}) == 1


        # 6. the cached aggregate on the user doc matches the collection
        drv_doc = await db.users.find_one({"_id": ObjectId(drv_id)})
        assert drv_doc["rating_avg"] == 3.0 and drv_doc["rating_count"] == 1

        # 7. reciprocal: the driver rates the passenger
        r = await ac.post("/api/v1/ratings", headers=_h(toks[drv]), json={
            "booking_id": booking_id, "stars": 4})
        assert r.status_code == 200 and r.json()["target_id"] == pax_id
        assert r.json()["target_rating_avg"] == 4.0

        # 8. public card: aggregate + histogram + feed
        card = (await ac.get("/api/v1/ratings/user/" + drv_id,
                 headers=_h(toks[other]))).json()
        assert card["rating_avg"] == 3.0 and card["rating_count"] == 1
        assert card["distribution"] == {"1": 0, "2": 0, "3": 1, "4": 0, "5": 0}
        assert card["items"][0]["comment"] is None
        assert card["items"][0]["rater_id"] == pax_id
        # the public profile (Module 4) now shows a real score
        pub = (await ac.get("/api/v1/users/" + drv_id,
                headers=_h(toks[other]))).json()
        assert pub["rating_avg"] == 3.0 and pub["rating_count"] == 1

        # 9. per-booking review thread: parties only
        thread = (await ac.get("/api/v1/ratings/booking/" + booking_id,
                  headers=_h(toks[pax]))).json()
        assert thread["count"] == 2  # both directions recorded
        assert (await ac.get("/api/v1/ratings/booking/" + booking_id,
                headers=_h(toks[other]))).status_code == 403

        # 10. pending now shows the score I already gave (update affordance)
        pend = (await ac.get("/api/v1/ratings/pending",
                 headers=_h(toks[pax]))).json()
        assert pend["unrated"] == 0 and pend["items"][0]["my_stars"] == 3

        # 11. out-of-range stars are rejected by the validation boundary
        assert (await ac.post("/api/v1/ratings", headers=_h(toks[pax]), json={
            "booking_id": booking_id, "stars": 6})).status_code == 422
        assert (await ac.post("/api/v1/ratings", headers=_h(toks[pax]), json={
            "booking_id": booking_id, "stars": 0})).status_code == 422

        # 12. the admin console (Module 21) surfaces the score
        await db.users.update_one({"_id": ObjectId(drv_id)},
                                  {"$addToSet": {"roles": "admin"}})
        admin_tok = (await ac.post("/api/v1/auth/login", json={
            "phone": drv, "password": "pass1234"})).json()["access_token"]
        board = (await ac.get("/api/v1/admin/users",
                 headers=_h(admin_tok))).json()
        row = [u for u in board["users"] if u["id"] == drv_id][0]
        assert row["rating_avg"] == 3.0 and row["rating_count"] == 1

    for p in (drv, pax, other):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^RateTest"}})
    await db.bookings.delete_many({})
    await db.ratings.delete_many({})
