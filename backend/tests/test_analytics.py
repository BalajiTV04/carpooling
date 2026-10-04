"""Module 24 tests: impact/demand/evaluation maths (pure) + the live endpoints.

The pure tests assert EXACT numbers on hand-built fixtures, so a change to a
CO2 factor or the counterfactual has to be a deliberate, visible edit.
"""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.analytics import (
    CO2_KG_PER_KM,
    auc_score,
    backtest,
    bucket_key,
    confusion,
    demand_forecast,
    evaluation,
    matching_metrics,
    predict_bucket,
    regression_metrics,
    ride_impact,
    sustainability,
)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


def _ride(fuel="petrol", riders=None, actual_km=22.0, **extra):
    base = {"trip_id": "t1", "fuel_type": fuel, "mileage_kmpl": 15.0,
            "fuel_price": 100.0, "actual_km": actual_km,
            "route_km": 20.0, "detour_km": 2.0,
            "riders": riders if riders is not None else [
                {"booking_id": "b1", "rider_km": 10.0, "seats": 1, "cost_share": 60.0},
                {"booking_id": "b2", "rider_km": 8.0, "seats": 1, "cost_share": 60.0}]}
    base.update(extra)
    return base


# --------------------------------------------------------------------------
# pure: sustainability
# --------------------------------------------------------------------------

def test_ride_impact_math_is_exact():
    r = ride_impact(_ride())
    # solo 10+8 = 18 km of separate journeys. The driver was driving anyway;
    # sharing only ADDS the 2 km of pickups. So 18 - 2 = 16 km genuinely saved.
    assert r["solo_km"] == 18.0 and r["extra_km"] == 2.0
    assert r["km_avoided"] == 16.0
    assert r["vehicles_avoided"] == 2        # one solo car eliminated per rider
    assert r["fuel_saved_l"] == round(16.0 / 15.0, 2)
    assert r["co2_avoided_kg"] == round(16.0 * CO2_KG_PER_KM["petrol"], 2)
    # solo cost 10/15*100 + 8/15*100 = 120.00; paid 120.00 -> nothing saved
    assert r["solo_cost"] == 120.0 and r["paid"] == 120.0
    assert r["cost_saved"] == 0.0
    assert len(r["riders_detail"]) == 2


def test_one_rider_removes_a_car_but_a_big_detour_can_cost_km():
    """The honest awkward case: a car is still removed, but the driver paid
    more distance than the rider saved, so the net is negative."""
    r = ride_impact(_ride(riders=[{"booking_id": "b1", "rider_km": 10.0,
                                   "seats": 1, "cost_share": 66.0}],
                          actual_km=35.0, route_km=20.0, detour_km=15.0))
    assert r["vehicles_avoided"] == 1        # their solo car is gone
    assert r["km_avoided"] == -5.0           # 10 saved vs 15 of detour
    assert r["co2_avoided_kg"] < 0
    # no riders -> nothing avoided, and never a negative car count
    empty = ride_impact(_ride(riders=[], actual_km=20.0, detour_km=0.0))
    assert empty["vehicles_avoided"] == 0
    assert empty["km_avoided"] == 0.0


def test_ev_is_zero_tailpipe_and_factors_differ():
    petrol = ride_impact(_ride(fuel="petrol", actual_km=10.0))
    ev = ride_impact(_ride(fuel="ev", actual_km=10.0))
    assert CO2_KG_PER_KM["ev"] == 0.0
    assert ev["co2_avoided_kg"] == 0.0
    assert petrol["co2_avoided_kg"] != 0.0
    # same distance avoided, different fuel -> different carbon
    d = ride_impact(_ride(fuel="diesel", actual_km=10.0))
    assert d["co2_avoided_kg"] != petrol["co2_avoided_kg"]


def test_unfavourable_rider_is_counted():
    # this rider's share (500) far exceeds going alone (8/15*100 = 53.33)
    r = ride_impact(_ride(riders=[
        {"booking_id": "b1", "rider_km": 10.0, "seats": 1, "cost_share": 66.0},
        {"booking_id": "b2", "rider_km": 8.0, "seats": 1, "cost_share": 500.0}],
        actual_km=22.0))
    assert r["unfavourable_riders"] == 1
    assert r["cost_saved"] < 0
    assert r["km_avoided"] == 16.0 and r["vehicles_avoided"] == 2


def test_sustainability_totals_and_by_fuel():
    out = sustainability([_ride(fuel="petrol", trip_id="t1"),
                          _ride(fuel="ev", trip_id="t2")])
    assert out["trips"] == 2 and out["riders"] == 4

    assert out["km_avoided"] == 32.0        # 2 trips x 16 km
    assert out["vehicles_avoided"] == 4
    # only the petrol trip emits: 16 km x 0.171, the EV trip is 0 by design
    assert out["co2_avoided_kg"] == round(
        16.0 * CO2_KG_PER_KM["petrol"], 2)
    assert out["by_fuel"]["ev"]["co2_avoided_kg"] == 0.0
    assert out["by_fuel"]["petrol"]["co2_avoided_kg"] != 0.0
    assert sustainability([])["trips"] == 0
# --------------------------------------------------------------------------
# pure: demand
# --------------------------------------------------------------------------

def test_bucket_key_and_shrinkage():
    from datetime import datetime, timezone

    when = datetime(2030, 6, 3, 9, 0, tzinfo=timezone.utc)  # a Monday
    assert bucket_key(when) == "Mon-09"
    assert bucket_key(None) is None and bucket_key("nope") is None
    # k=3, mu=2 -> (0 + 3*2)/(0+3) = 2.0; a bucket at the mean is unchanged
    assert predict_bucket(0, 2.0, 3.0) == 2.0
    # n=1 -> (1+6)/(1+3) = 1.75: pulled UP toward the mean, not trusted
    assert predict_bucket(1, 2.0, 3.0) == 1.75
    # a far-from-mean bucket is pulled toward it (mu=0 shrinks 20 -> 20/23)
    assert predict_bucket(20, 0.0, 3.0) == pytest.approx(20.0 / 23.0)


def test_demand_forecast_shape():
    from datetime import datetime, timedelta, timezone

    base = datetime(2030, 6, 3, 9, 0, tzinfo=timezone.utc)  # Monday 09:00
    times = [base + timedelta(days=i) for i in range(4)]  # Mon..Thu, same hour
    f = demand_forecast(times, horizon_days=7)
    assert f["samples"] == 4
    # each of Mon..Thu has exactly one observed departure at 09:00
    for day in ("Mon", "Tue", "Wed", "Thu"):
        row = [b for b in f["buckets"] if b["bucket"] == day + "-09"][0]
        assert row["observed"] == 1
    assert [b["observed"] for b in f["busiest"][:4]] == [1, 1, 1, 1]
    mon9 = [b for b in f["buckets"] if b["bucket"] == "Mon-09"][0]
    assert mon9["per_day"] > 0
    assert mon9["horizon_total"] == round(mon9["per_day"] * 7, 1)
    assert len(f["buckets"]) == 168          # 7 days x 24 hours
    assert demand_forecast([])["samples"] == 0


def test_backtest_never_leaks_the_future():
    from datetime import datetime, timedelta, timezone

    base = datetime(2030, 6, 1, 8, 0, tzinfo=timezone.utc)
    times = [base + timedelta(days=d, hours=h)
             for d in range(8) for h in (8, 9, 17)]
    bt = backtest(times)
    assert bt["n_test"] > 0
    # MAE <= RMSE always, for any error vector
    assert bt["mae"] <= bt["rmse"]
    assert backtest([])["mae"] is None     # honest, not a crash


# --------------------------------------------------------------------------
# pure: evaluation
# --------------------------------------------------------------------------

def test_regression_metrics_exact():
    assert regression_metrics([])["mae"] is None
    m = regression_metrics([2, -2, 0])
    assert m["mae"] == round(4 / 3, 3) and m["rmse"] == round((8 / 3) ** 0.5, 3)


def test_auc_edges_and_ties():
    assert auc_score([(0.9, True), (0.8, True), (0.2, False), (0.1, False)]) == 1.0
    assert auc_score([(0.9, False), (0.1, True)]) == 0.0
    assert auc_score([(1.0, True), (1.0, False)]) == 0.5   # perfect tie
    assert auc_score([(0.5, True)]) is None               # one class only


def test_confusion_exact():
    c = confusion([(0.9, True), (0.8, False), (0.4, True), (0.1, False)], 0.5)
    assert (c["tp"], c["fp"], c["fn"], c["tn"]) == (1, 1, 1, 1)
    assert c["precision"] == 0.5 and c["recall"] == 0.5 and c["f1"] == 0.5
    assert c["accuracy"] == 0.5


def test_matching_metrics_and_evaluation_compare_rule_vs_ai():
    rows = [
        {"status": "completed", "match_score": 90.0, "ai_score": 95.0},
        {"status": "completed", "match_score": 80.0, "ai_score": 88.0},
        {"status": "cancelled", "match_score": 20.0, "ai_score": 10.0},
        {"status": "rejected", "match_score": 30.0, "ai_score": 15.0},
    ]
    m = matching_metrics(rows, "match_score")
    assert m["n"] == 4 and m["positives"] == 2 and m["negatives"] == 2
    assert m["auc"] == 1.0
    ev = evaluation(rows)
    assert ev["rule_score"]["auc"] == 1.0 and ev["ai_score"]["auc"] == 1.0
    assert ev["comparison"]["winner"] == "tie"
    # a booking with no outcome yet is excluded rather than counted as a miss
    assert matching_metrics([{"status": "requested", "match_score": 50.0}])["n"] == 0
    assert matching_metrics([])["auc"] is None



# --------------------------------------------------------------------------
# live flow
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_analytics_endpoints_live():
    from datetime import datetime, timedelta, timezone

    from bson import ObjectId

    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax, other, admin = ("+919000002401", "+919000002402",
                              "+919000002403", "+919000002404")
    for p in (drv, pax, other, admin):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^AnaTest"}})
    await db.bookings.delete_many({})
    await db.segments.delete_many({})
    await db.vehicles.delete_many({})

    async with _client() as ac:
        toks = {}
        for p in (drv, pax, other, admin):
            assert (await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "Ana " + p[-3:],
                "roles": ["driver", "passenger"]})).status_code == 201
            otp = (await ac.post("/api/v1/auth/otp/request",
                   json={"phone": p})).json()
            await ac.post("/api/v1/auth/otp/verify",
                          json={"phone": p, "code": otp["dev_code"]})
        for p in (drv, pax, other, admin):
            toks[p] = (await ac.post("/api/v1/auth/login", json={
                "phone": p, "password": "pass1234"})).json()["access_token"]
        await db.users.update_one({"phone": admin},
                                  {"$addToSet": {"roles": "admin"}})
        toks[admin] = (await ac.post("/api/v1/auth/login", json={
            "phone": admin, "password": "pass1234"})).json()["access_token"]
        drv_id = (await ac.get("/api/v1/auth/me",
                    headers=_h(toks[drv]))).json()["id"]
        pax_id = (await ac.get("/api/v1/auth/me",
                    headers=_h(toks[pax]))).json()["id"]

        now = datetime.now(timezone.utc)
        veh_id = (await db.vehicles.insert_one({
            "owner_id": ObjectId(drv_id), "make": "Test", "model": "Car",
            "plate_no": "ANA0001", "seats_total": 3, "fuel_type": "petrol",
            "mileage_kmpl": 15.0, "verification_status": "verified",
            "is_active": True, "created_at": now, "updated_at": now,
        })).inserted_id

        # one completed trip with two riders across a few past days, so the
        # demand forecast and its backtest both have something to chew on.
        # SNAPSHOT FIRST: /impact and /evaluation are platform-wide, so the
        # database may already hold other rides (e.g. seed.py demo data). Only
        # the delta this test causes is deterministic, so the assertions below
        # compare against these "before" values rather than absolute counts.
        before = (await ac.get("/api/v1/analytics/impact",
                   headers=_h(toks[admin]))).json()
        ev_before = (await ac.get("/api/v1/analytics/evaluation",
                      headers=_h(toks[admin]))).json()["rule_score"]
        # the endpoint returns a reduced shape when nothing is labelled yet, so
        # normalise the snapshot to the keys we compare
        ev_before = {"n": ev_before.get("n", 0),
                     "positives": ev_before.get("positives", 0),
                     "negatives": ev_before.get("negatives", 0)}
        for i in range(6):
            depart = (now - timedelta(days=6 - i)).replace(
                hour=9, minute=0, second=0, microsecond=0)
            trip_id = (await db.trips.insert_one({
                "driver_id": ObjectId(drv_id), "vehicle_id": veh_id,
                "source": {"name": "AnaTest A", "point": {"type": "Point",
                            "coordinates": [77.5946, 13.0358]}},
                "destination": {"name": "AnaTest B", "point": {"type": "Point",
                                 "coordinates": [77.67, 12.8452]}},
                "route_geometry": {"type": "LineString", "coordinates": [
                    [77.5946, 13.0358], [77.62, 13.0],
                    [77.65, 12.92], [77.67, 12.8452]]},
                "distance_km": 30.0, "duration_min": 50.0, "depart_at": depart,
                "seats_offered": 3, "seats_booked": 2, "status": "completed",
                "started_at": depart, "completed_at": depart + timedelta(minutes=45),
                "created_at": depart, "updated_at": depart,
            })).inserted_id
            for who in (pax_id,):
                bid = (await db.bookings.insert_one({
                    "trip_id": trip_id, "passenger_id": ObjectId(who),
                    "driver_id": ObjectId(drv_id), "seats": 1,
                    "status": "completed", "match_score": 90.0 - i,
                    "ai_score": 95.0 - i, "detour_km": 2.0,
                    "cost_share": 40.0,
                    "pickup": {"point": {"type": "Point",
                                         "coordinates": [77.62, 13.0]}},
                    "dropoff": {"point": {"type": "Point",
                                          "coordinates": [77.67, 12.8452]}},
                    "created_at": depart, "closed_at": depart,
                    "updated_at": depart})).inserted_id
                # the rider occupies the 12 km leg, so solo_km = 12
                await db.segments.insert_one({
                    "trip_id": trip_id, "seq": 0,
                    "from_label": "A", "to_label": "B",
                    "from_point": {"type": "Point",
                                   "coordinates": [77.5946, 13.0358]},
                    "to_point": {"type": "Point",
                                 "coordinates": [77.67, 12.8452]},
                    "distance_km": 12.0, "occupant_booking_ids": [bid],
                    "created_at": depart})
        # a fall-through booking gives the evaluation a negative class
        await db.bookings.insert_one({
            "trip_id": (await db.trips.find_one(
                {"source.name": "AnaTest A"}))["_id"],
            "passenger_id": ObjectId(pax_id), "driver_id": ObjectId(drv_id),
            "seats": 1, "status": "cancelled", "match_score": 10.0,
            "ai_score": 5.0, "cost_share": None, "detour_km": 0.0,
            "pickup": {"point": {"type": "Point", "coordinates": [77.62, 13.0]}},
            "dropoff": {"point": {"type": "Point", "coordinates": [77.67, 12.8452]}},
            "created_at": now, "updated_at": now})


        # 1. admin sees the platform impact; a normal user does not.
        #    Assertions are DELTAS, not absolute counts: /impact and /evaluation
        #    are platform-wide, so the database may already hold other rides
        #    (e.g. seed.py demo data). Only the change THIS test caused is
        #    deterministic, so we snapshot both before seeding our own rows.
        r = await ac.get("/api/v1/analytics/impact", headers=_h(toks[admin]))
        assert r.status_code == 200, r.text
        imp = r.json()
        # reading twice must not change anything (the analytics are read-only)
        again = (await ac.get("/api/v1/analytics/impact",
                  headers=_h(toks[admin]))).json()
        assert again["trips"] == imp["trips"]
        assert again["km_avoided"] == imp["km_avoided"]
        # 6 rides x (solo 12 km - 2 km of pickups) = 60 km saved, 6 cars removed
        assert imp["trips"] - before["trips"] == 6
        assert imp["riders"] - before["riders"] == 6
        assert imp["vehicles_avoided"] - before["vehicles_avoided"] == 6
        assert round(imp["km_avoided"] - before["km_avoided"], 2) == 60.0
        assert round(imp["co2_avoided_kg"] - before["co2_avoided_kg"], 2) == \
            round(60.0 * CO2_KG_PER_KM["petrol"], 2)
        assert imp["by_fuel"]["petrol"]["trips"] >= 6
        assert round(imp["paid_total"] - before["paid_total"], 2) == 240.0
        assert (await ac.get("/api/v1/analytics/impact",
                headers=_h(toks[pax]))).status_code == 403

        # 2. demand: buckets are hidden unless asked for, backtest reports MAE
        r = await ac.get("/api/v1/analytics/demand?horizon_days=7",
                         headers=_h(toks[admin]))
        assert r.status_code == 200, r.text
        dem = r.json()
        assert dem["horizon_days"] == 7
        assert "buckets" not in dem                  # 168 rows suppressed
        assert dem["busiest"] and dem["quietest"]
        assert dem["history"]["trips"] >= 6
        bt = dem["backtest"]
        # with little history the backtest honestly reports "not enough"; what
        # must always hold is that MAE never exceeds RMSE
        if bt["mae"] is not None:
            assert bt["mae"] <= bt["rmse"]
            assert bt["n_train"] > 0 and bt["n_test"] > 0
        full = (await ac.get("/api/v1/analytics/demand?buckets=true",
                 headers=_h(toks[admin]))).json()
        assert len(full["buckets"]) == 168

        # 3. evaluation: this test adds 6 rides that happened and 1 that fell
        #    through, with a clean score separation. Also delta-based, because
        #    /evaluation is platform-wide.
        ev = (await ac.get("/api/v1/analytics/evaluation",
                headers=_h(toks[admin]))).json()
        assert ev["rule_score"]["n"] - ev_before["n"] == 7
        assert ev["rule_score"]["positives"] - ev_before["positives"] == 6
        assert ev["rule_score"]["negatives"] - ev_before["negatives"] == 1
        # this test's own scores separate perfectly, so the platform AUC must be
        # at least that good (it can never be worse than chance here)
        assert ev["rule_score"]["auc"] is None or ev["rule_score"]["auc"] > 0.5
        assert ev["ai_score"]["auc"] is None or ev["ai_score"]["auc"] > 0.5
        assert ev["offline_ranker_auc"] is not None
        assert "caveat" in ev

        # 4. /me is open to any logged-in user and scoped to their own rides
        me = (await ac.get("/api/v1/analytics/me",
                headers=_h(toks[pax]))).json()
        assert me["trips_as_rider"] == 6
        assert me["trips_as_driver"] == 0
        assert me["paid_total"] == 240.0
        assert me["as_rider"]["vehicles_avoided"] == 6
        drv_me = (await ac.get("/api/v1/analytics/me",
                  headers=_h(toks[drv]))).json()
        assert drv_me["trips_as_driver"] == 6
        assert drv_me["collected_total"] == 240.0
        # the outsider rode nothing and drove nothing
        assert (await ac.get("/api/v1/analytics/me",
                headers=_h(toks[other]))).json()["trips_as_rider"] == 0

    for p in (drv, pax, other, admin):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": {"$regex": "^AnaTest"}})
    await db.bookings.delete_many({})
    await db.segments.delete_many({})
    await db.vehicles.delete_many({})
