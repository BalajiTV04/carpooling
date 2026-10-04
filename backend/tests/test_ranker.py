"""Module 16 tests: AI ranker pure math + live re-rank + snapshot."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.ranker import (
    ai_score_from_features,
    enrich_match,
    extract_features,
    model_info,
    score_match,
)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def test_features_mirror_ml_spec():
    f = extract_features(overlap_pct=100.0, pickup_km=0.0, dropoff_km=0.0,
                         time_diff_min=0.0)
    assert f == {"overlap01": 1.0, "pickup01": 1.0,
                 "dropoff01": 1.0, "time01": 1.0}
    f2 = extract_features(overlap_pct=50.0, pickup_km=1.5, dropoff_km=2.5,
                          time_diff_min=60.0)
    assert f2 == {"overlap01": 0.5, "pickup01": 0.5,
                  "dropoff01": 0.5, "time01": 0.5}
    assert extract_features(time_diff_min=None)["time01"] == 0.6


def test_ai_score_prefers_better_ride_and_monotonic():
    good = {"overlap01": 1.0, "pickup01": 1.0, "dropoff01": 1.0, "time01": 1.0}
    bad = {"overlap01": 0.2, "pickup01": 0.2, "dropoff01": 0.2, "time01": 0.2}
    assert ai_score_from_features(good) > ai_score_from_features(bad)
    assert 0.0 <= ai_score_from_features(bad) <= 100.0
    full = score_match(100.0, 0.0, 0.0, 0.0, rule_score=90.0)
    hop = score_match(20.0, 0.0, 0.0, 0.0, rule_score=60.0)
    assert full["ai_score"] > hop["ai_score"]
    assert full["blended"] == round(0.5 * 90.0 + 0.5 * full["ai_score"], 1)
    assert set(full["contributions"]) == {"overlap01", "pickup01",
                                          "dropoff01", "time01"}
    assert full["model"] in ("logreg", "rule-fallback")


def test_enrich_never_rescues_gated_ride():
    m = {"feasible": False, "reason": "wrong direction along route", "score": 0.0}
    enrich_match(m)
    assert m["ai_score"] is None
    assert m["feasible"] is False


def test_model_info_reports_logreg_when_artifact_present():
    info = model_info()
    assert info["model"] in ("logreg", "rule-fallback")
    if info["model"] == "logreg":
        assert len(info["weights"]) == 4
        assert info["auc"]["logreg"] > 0.85



@pytest.mark.asyncio
async def test_search_rerank_and_booking_snapshot_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax = "+919000001601", "+919000001602"
    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^RankTest"}})
    await db.bookings.delete_many({})

    async with _client() as ac:
        for p in (drv, pax):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Rank " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t_pax = (await ac.post("/api/v1/auth/login",
                 json={"phone": pax, "password": "pass1234"})).json()["access_token"]
        uid = (await ac.get("/api/v1/auth/me", headers=_h(t_drv))).json()["id"]

        depart = (datetime.now(timezone.utc) + timedelta(days=5)).replace(
            hour=9, minute=0, second=0, microsecond=0)
        day = depart.strftime("%Y-%m-%d")
        route = {"type": "LineString", "coordinates": [
            [77.5946, 13.0358], [77.62, 13.0], [77.65, 12.92], [77.67, 12.8452]]}
        base = {"driver_id": ObjectId(uid), "vehicle_id": ObjectId(),
                "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
                "seats_offered": 3, "seats_booked": 0, "status": "published",
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)}
        full = dict(base,
                    source={"name": "RankTest A", "point": {"type": "Point",
                            "coordinates": [77.5946, 13.0358]}},
                    destination={"name": "RankTest B", "point": {"type": "Point",
                                 "coordinates": [77.67, 12.8452]}},
                    route_geometry=route)
        full_id = str((await db.trips.insert_one(full)).inserted_id)
        # second trip: same endpoints, longer tail beyond the destination.
        # Passenger drop-off then projects mid-route (~80% overlap vs 100%),
        # so both stay feasible but the full ride must rank first on blended.
        tail_route = {"type": "LineString", "coordinates": route["coordinates"] + [
            [77.70, 12.80]]}
        tailed = dict(base,
                      source={"name": "RankTest A2", "point": {"type": "Point",
                              "coordinates": [77.5946, 13.0358]}},
                      destination={"name": "RankTest B2", "point": {"type": "Point",
                                   "coordinates": [77.67, 12.8452]}},
                      route_geometry=tail_route)
        await db.trips.insert_one(tailed)

        info = (await ac.get("/api/v1/rank/info", headers=_h(t_pax))).json()
        assert info["model"] in ("logreg", "rule-fallback")

        q = {"src_coordinates": [77.5946, 13.0358],
             "dst_coordinates": [77.67, 12.8452],
             "date": day, "seats": 1, "time": "09:00"}
        r = await ac.post("/api/v1/search/rides", json=q, headers=_h(t_pax))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 2
        assert body["ai"]["model"] in ("logreg", "rule-fallback")
        first, second = body["results"][0], body["results"][1]
        for hit in (first, second):
            assert hit["match"]["ai_score"] is not None
            assert hit["match"]["blended"] is not None
        blends = [h["match"]["blended"] for h in body["results"]]
        assert blends == sorted(blends, reverse=True)
        assert first["id"] == full_id

        b = (await ac.post("/api/v1/bookings", headers=_h(t_pax), json={
            "trip_id": full_id, "seats": 1,
            "pickup_coordinates": [77.5946, 13.0358],
            "dropoff_coordinates": [77.67, 12.8452]})).json()
        assert b["ai_score"] is not None
        stored = await db.bookings.find_one({"trip_id": ObjectId(full_id)})
        assert stored["ai_score"] == b["ai_score"]
        assert stored["match_explain"]["ai_score"] == b["ai_score"]

    for p in (drv, pax):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^RankTest"}})
    await db.bookings.delete_many({})
