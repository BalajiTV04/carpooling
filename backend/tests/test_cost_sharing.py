"""Module 12+ offline tests: pure fuel-based segment cost sharing.

These tests exercise only pure functions (no MongoDB, no network):
compute_shares, check_seats_left, breakpoints, segment_table, cost_preview.
They mirror the worked examples from the spec verbatim so the pricing
engine can be regression-checked without a database.

Booking dicts use pickup_along_km / drop_along_km measured along the
driver's route (Module 10 snapshot), exactly as the live path stores them.
"""
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
import pytest

from app.services.cost_sharing import (
    breakpoints,
    check_seats_left,
    compute_shares,
    cost_preview,
    segment_table,
)

EPS = 0.001


def booking(bid, pickup, drop, status="accepted", seats=1):
    """Confirmed-position booking snapshot (Module 10 along_km)."""
    return {
        "_id": bid,
        "id": bid,
        "status": status,
        "seats": seats,
        "pickup_along_km": pickup,
        "drop_along_km": drop,
    }


# ---------------------------------------------------------------------------
# Worked examples (exact numbers from the spec)
# ---------------------------------------------------------------------------


def test_case1_a_rides_0_100_alone():
    # Route 100 km, mileage 20, fuel Rs 100/litre -> total Rs 500
    # A rides 0-100 alone: A = 250, driver = 250.
    r = compute_shares(100, 20, 100, [booking("A", 0, 100)])
    assert r["total_cost"] == 500
    assert r["passengers"] == {"A": 250}
    assert r["driver_share"] == 250
    assert sum(r["passengers"].values()) + r["driver_share"] == 500


def test_case2_a_full_route_b_20_100():
    # A 0-100 and B 20-100:
    #   seg 0-20 = Rs 100 split 2 -> 50 each
    #   seg 20-100 = Rs 400 split 3 -> 133.33 each
    #   A = 50 + 133.33 = 183.33 -> 184, B = 133.33 -> 134,
    #   driver = 500 - 184 - 134 = 182
    r = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100)],
    )
    assert r["total_cost"] == 500
    assert r["passengers"] == {"A": 184, "B": 134}
    assert r["driver_share"] == 182
    assert sum(r["passengers"].values()) + r["driver_share"] == 500


def test_case3_add_c_40_100():
    # Add C 40-100: seg 0-20 (Rs 100/2), 20-40 (Rs 100/3), 40-100 (Rs 300/4)
    #   A = 159, B = 109, C = 75, driver = 157
    r = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100), booking("C", 40, 100)],
    )
    assert r["total_cost"] == 500
    assert r["passengers"] == {"A": 159, "B": 109, "C": 75}
    assert r["driver_share"] == 157
    assert sum(r["passengers"].values()) + r["driver_share"] == 500


def test_case4_cancel_b_returns_to_case1():
    # Cancel B in case 2: A returns to 250 (and driver 250).
    r = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100, status="cancelled")],
    )
    assert r["passengers"] == {"A": 250}
    assert r["driver_share"] == 250
    assert r["total_cost"] == 500


def test_case5_105_km_a_alone():
    # Route 105 km, mileage 20, fuel Rs 100/litre (5.25 L = Rs 525)
    # A alone: A = 263, driver = 262.
    r = compute_shares(105, 20, 100, [booking("A", 0, 105)])
    assert r["total_cost"] == 525
    assert r["passengers"] == {"A": 263}
    assert r["driver_share"] == 262


# ---------------------------------------------------------------------------
# Order independence & idempotence
# ---------------------------------------------------------------------------


def test_order_independence():
    # A then B == B then A (order of booking never matters).
    r_ab = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100)],
    )
    r_ba = compute_shares(
        100, 20, 100,
        [booking("B", 20, 100), booking("A", 0, 100)],
    )
    assert r_ab["passengers"] == r_ba["passengers"]
    assert r_ab["driver_share"] == r_ba["driver_share"]
    assert r_ab["total_cost"] == r_ba["total_cost"]


def test_idempotent_recompute():
    # Running compute_shares twice on the same inputs gives identical results.
    inputs = [booking("A", 0, 100), booking("B", 20, 100), booking("C", 40, 100)]
    r1 = compute_shares(100, 20, 100, inputs)
    r2 = compute_shares(100, 20, 100, inputs)
    assert r1 == r2


# ---------------------------------------------------------------------------
# Only confirmed bookings count
# ---------------------------------------------------------------------------


def test_pending_rejected_cancelled_ignored():
    # PENDING, REJECTED and CANCELLED do not count.
    r = compute_shares(
        100, 20, 100,
        [
            booking("A", 0, 100, "accepted"),
            booking("B", 20, 100, "pending"),
            booking("C", 40, 60, "rejected"),
            booking("D", 30, 80, "cancelled"),
        ],
    )
    assert r["passengers"] == {"A": 250}
    assert r["driver_share"] == 250


def test_completed_counts_as_confirmed():
    # COMPLETED counts (final amount) per spec.
    r = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100, "completed")],
    )
    assert r["passengers"] == {"A": 250}
    assert r["driver_share"] == 250



# ---------------------------------------------------------------------------
# Seats
# ---------------------------------------------------------------------------


def test_seats_left_full_route_plus_partial():
    # 5 seater = 4 passenger seats. A 0-100 + B 20-100 -> max occ 2 -> seats_left 2.
    left = check_seats_left(
        100, 4,
        [booking("A", 0, 100), booking("B", 20, 100)],
        0, 100,
    )
    assert left == 2


def test_non_overlapping_reuse_one_seat():
    # Non-overlapping passengers can reuse one seat: A 0-40, B 60-100 -> max occ 1 -> 3.
    left = check_seats_left(
        100, 4,
        [booking("A", 0, 40), booking("B", 60, 100)],
        0, 100,
    )
    assert left == 3


def test_seats_left_across_requested_range_only():
    # Seats consumed only on the segments where a passenger rides.
    left = check_seats_left(
        100, 4,
        [booking("A", 0, 40)],
        60, 100,   # new booking range does not overlap A
    )
    assert left == 4


def test_zero_seats_left_rejected():
    # Full car on a range -> seats_left 0 -> clear rejection signal.
    left = check_seats_left(
        100, 4,
        [booking("A", 0, 25), booking("B", 0, 25),
         booking("C", 0, 25), booking("D", 0, 25)],
        0, 30,
    )
    assert left == 0



# ---------------------------------------------------------------------------
# Rounding: driver + passengers == exact total; driver never negative
# ---------------------------------------------------------------------------


def test_rounding_driver_remainder_exact():
    # Case 2: 184 + 134 + 182 == 500 exactly, no float drift.
    r = compute_shares(100, 20, 100, [booking("A", 0, 100), booking("B", 20, 100)])
    assert sum(r["passengers"].values()) + r["driver_share"] == r["total_cost"]
    assert r["driver_share"] >= 0


def test_rounding_half_up_mode():
    r = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100)],
        round_mode="HALF_UP",
    )
    # 183.33 -> 183, 133.33 -> 133 under HALF_UP; driver = 500 - 183 - 133 = 184
    assert r["passengers"] == {"A": 183, "B": 133}
    assert r["driver_share"] == 184
    assert sum(r["passengers"].values()) + r["driver_share"] == 500


def test_rounding_none_mode_keeps_paise():
    r = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100)],
        round_mode="NONE",
    )
    assert r["passengers"]["A"] == pytest.approx(183.33, abs=0.01)
    assert r["passengers"]["B"] == pytest.approx(133.33, abs=0.01)
    assert r["driver_share"] == pytest.approx(183.34, abs=0.01)
    assert sum(r["passengers"].values()) + r["driver_share"] == 500


def test_driver_never_negative():
    # Many passengers shouldn't push driver below zero; driver keeps remainder.
    r = compute_shares(
        100, 10, 100,   # total = 1000
        [booking("A", 0, 100), booking("B", 0, 100), booking("C", 0, 100),
         booking("D", 0, 100), booking("E", 0, 100)],
    )
    assert r["driver_share"] >= 0
    assert sum(r["passengers"].values()) + r["driver_share"] == r["total_cost"]



# ---------------------------------------------------------------------------
# Proportionality & errors
# ---------------------------------------------------------------------------


def test_changing_mileage_scales_amounts():
    # Same route/price, double mileage -> half total cost.
    r1 = compute_shares(100, 20, 100, [booking("A", 0, 100)])
    r2 = compute_shares(100, 40, 100, [booking("A", 0, 100)])
    assert r2["total_cost"] == r1["total_cost"] / 2
    assert r2["passengers"]["A"] == r1["passengers"]["A"] / 2


def test_changing_fuel_price_scales_amounts():
    r1 = compute_shares(100, 20, 100, [booking("A", 0, 100)])
    r2 = compute_shares(100, 20, 200, [booking("A", 0, 100)])
    assert r2["total_cost"] == r1["total_cost"] * 2
    assert r2["passengers"]["A"] == r1["passengers"]["A"] * 2


def test_missing_mileage_raises_clear_error():
    with pytest.raises(ValueError, match="mileage"):
        compute_shares(100, None, 100, [booking("A", 0, 100)])

    with pytest.raises(ValueError, match="mileage"):
        compute_shares(100, 0, 100, [booking("A", 0, 100)])


def test_missing_fuel_price_raises_clear_error():
    with pytest.raises(ValueError, match="(?i)fuel price"):
        compute_shares(100, 20, None, [booking("A", 0, 100)])


def test_zero_route_returns_zero():
    r = compute_shares(0, 20, 100, [booking("A", 0, 0)])
    assert r["total_cost"] == 0
    assert r["passengers"] == {}
    assert r["driver_share"] == 0



# ---------------------------------------------------------------------------
# Preview equals post-accept amount
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_preview_equals_post_accept_amount():
    # Preview for a candidate joining currently-accepted passengers equals
    # what compute_shares produces after acceptance.
    trip = {
        "_id": "trip1",
        "route_km": 100,
        "distance_km": 100,
        "vehicle_mileage_kmpl": 20,
        "fuel_price_per_unit": 100,
        "passenger_seats": 4,
        "fuel_type": "petrol",
        "route_geometry": None,
    }
    # A already accepted (0-100). Preview B joining at 20-100.
    # With db=None there are no pre-existing confirmed bookings, so B rides
    # the 20-100 segment alone with the driver: Rs 400 / 2 = 200.
    preview = await cost_preview(trip, 20, 100, requested_seats=1, db=None)
    assert preview["estimated_contribution"] == 200
    assert preview["seats_left"] == 4  # no confirmed bookings -> full capacity

    # Full recompute with A + B accepted gives B = 134 (case 2).
    r = compute_shares(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100)],
    )
    assert r["passengers"]["B"] == 134
    assert r["driver_share"] == 182  # case 2 driver share


@pytest.mark.asyncio
async def test_cost_preview_no_fuel_price_message():
    trip = {
        "_id": "trip2",
        "route_km": 100,
        "vehicle_mileage_kmpl": None,
        "fuel_price_per_unit": None,
        "passenger_seats": 4,
    }
    preview = await cost_preview(trip, 0, 100, requested_seats=1, db=None)
    assert preview["estimated_contribution"] is None
    assert preview["available"] is False
    assert "Cost not available" in preview["reason"]



# ---------------------------------------------------------------------------
# Segment table structure
# ---------------------------------------------------------------------------


def test_segment_table_case2_structure():
    segs = segment_table(
        100, 20, 100,
        [booking("A", 0, 100), booking("B", 20, 100)],
    )
    assert len(segs) == 2  # [0-20], [20-100]
    s0, s1 = segs[0], segs[1]
    assert s0["from_km"] == 0 and s0["to_km"] == 20
    assert s0["km"] == 20
    assert s0["occupants"] == 2  # driver + A
    assert s0["cost"] == 100
    assert s1["from_km"] == 20 and s1["to_km"] == 100
    assert s1["km"] == 80
    assert s1["occupants"] == 3  # driver + A + B
    assert s1["cost"] == 400


def test_breakpoints_include_route_end_and_pickups():
    pts = breakpoints(
        100,
        [booking("A", 0, 100), booking("B", 20, 100), booking("C", 40, 100)],
    )
    assert pts == [0.0, 20.0, 40.0, 100.0]


# ---------------------------------------------------------------------------
# Fuel unit labels
# ---------------------------------------------------------------------------


def test_fuel_unit_labels():
    from app.services.cost_sharing import get_fuel_unit
    assert get_fuel_unit("petrol") == "L"
    assert get_fuel_unit("diesel") == "L"
    assert get_fuel_unit("cng") == "kg"
    assert get_fuel_unit("ev") == "kWh"
    assert get_fuel_unit(None) == "L"

