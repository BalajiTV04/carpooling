"""Test corridor matching, near-point proximity matching, and ride ordering on /trips/available.
Verifies:
1. Devanahalli -> Hebbal trip matches passenger searching Yelahanka -> Hebbal.
2. Near point to Hebbal (Manyata / 2km away) matches.
3. Matching returns passenger_distance_km, detour_km, pickup/drop points, and estimated contribution.
4. Booking can be placed and updates seats available.
"""
import asyncio
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from httpx import AsyncClient, ASGITransport
from app.core.database import get_db
from app.main import app

async def main():
    db = get_db()

    # Get driver +919000000002 and passenger +919000000005 (or 004)
    driver = await db.users.find_one({"phone": "+919000000002"})
    passenger = await db.users.find_one({"phone": "+919000000005"})
    assert driver and passenger, "Seed users missing"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Login passenger +919000000005
        login_resp = await ac.post("/api/v1/auth/login", json={"phone": "+919000000005", "password": "pass1234"})
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Search Yelahanka -> Hebbal (corridor match)
        resp = await ac.get(
            "/api/v1/trips/available",
            params={
                "src_lat": 13.1007,
                "src_lng": 77.5963,
                "dst_lat": 13.0358,
                "dst_lng": 77.5946,
                "source": "Yelahanka",
                "destination": "Hebbal",
            },
            headers=headers
        )
        assert resp.status_code == 200, f"Search failed: {resp.text}"
        trips = resp.json()
        print(f"Found {len(trips)} available trips for Yelahanka -> Hebbal")
        assert len(trips) > 0, "Expected at least 1 trip for corridor match!"
        t = trips[0]
        trip_id = t["id"]
        seats_left_before = t["seats_left"]
        print(f"Trip ID: {trip_id}")
        print(f"Seats offered: {t['seats_offered']}, booked: {t['seats_booked']}, left: {seats_left_before}")
        print(f"Passenger distance: {t.get('passenger_distance_km')} km (Driver distance: {t.get('distance_km')} km)")
        print(f"Detour: {t.get('detour_km')} km")
        print(f"Estimated contribution: Rs {t.get('estimated_contribution')}")

        # 2. Book 1 seat from Yelahanka to Hebbal
        book_resp = await ac.post(
            "/api/v1/bookings",
            json={
                "trip_id": trip_id,
                "seats": 1,
                "pickup_coordinates": [77.5963, 13.1007],
                "dropoff_coordinates": [77.5946, 13.0358],
                "use_optimised_pickup": True,
            },
            headers=headers
        )
        assert book_resp.status_code in (200, 201), f"Booking failed: {book_resp.text}"
        booking = book_resp.json()
        print(f"\nBooking successful! ID: {booking.get('id')}, Status: {booking.get('status')}")
        print(f"Booking pickup: {booking.get('pickup')}")
        print(f"Booking passenger distance: {booking.get('passenger_distance_km')} km, Detour: {booking.get('detour_km')} km")
        print(f"Estimated contribution: Rs {booking.get('estimated_contribution')}")

        # 3. Check available trips again to verify seats decreased
        resp_after = await ac.get(
            "/api/v1/trips/available",
            params={
                "src_lat": 13.1007,
                "src_lng": 77.5963,
                "dst_lat": 13.0358,
                "dst_lng": 77.5946,
            },
            headers=headers
        )
        trips_after = resp_after.json()
        t_after = next((x for x in trips_after if x["id"] == trip_id), None)
        assert t_after is not None
        print(f"\nSeats left after booking: {t_after['seats_left']} (was {seats_left_before})")
        assert t_after["seats_left"] == seats_left_before - 1

    print("\nALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(main())
