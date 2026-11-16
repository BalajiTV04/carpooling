"""Create demo trip for driver +919000000002 and book 1 seat with passenger +919000000004.

Workflow:
1. Driver +919000000002 publishes trip Devanahalli -> Hebbal (4 seats offered, 4+1 car capacity).
2. Passenger +919000000004 searches Yelahanka -> Hebbal.
3. Passenger orders/books 1 seat.
4. Booking is accepted/confirmed.
5. Verifies remaining available seats = 3 (4 offered - 1 booked = 3 available).
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bson import ObjectId
from httpx import AsyncClient, ASGITransport

from app.core.database import get_db
from app.main import app

DEV = [77.7120, 13.2437]  # Devanahalli
YEL = [77.5963, 13.1007]  # Yelahanka
HEB = [77.5970, 13.0358]  # Hebbal

FIXTURE_PATH = ROOT / "tests" / "fixtures" / "devanahalli_hebbal.json"


async def main():
    db = get_db()
    
    # 1. Resolve Driver +919000000002
    drv = await db.users.find_one({"phone": "+919000000002"})
    if not drv:
        print("Driver +919000000002 not found!")
        return
    drv_id = drv["_id"]
    
    # Ensure vehicle has 4+1 capacity (seats_total = 5)
    veh = await db.vehicles.find_one({"owner_id": drv_id})
    now = datetime.now(timezone.utc)
    if not veh:
        veh_id = (await db.vehicles.insert_one({
            "owner_id": drv_id,
            "make": "Tata",
            "model": "Nexon EV",
            "year": 2023,
            "color": "Teal Blue",
            "plate_no": "KA04EV4411",
            "seats_total": 5,
            "fuel_type": "diesel",
            "mileage_kmpl": 18.0,
            "verification_status": "verified",
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        })).inserted_id
    else:
        veh_id = veh["_id"]
        await db.vehicles.update_one(
            {"_id": veh_id},
            {"$set": {"seats_total": 5, "mileage_kmpl": 18.0, "is_active": True, "verification_status": "verified"}}
        )

    # 2. Resolve Passenger +919000000004
    pax = await db.users.find_one({"phone": "+919000000004"})
    if not pax:
        print("Passenger +919000000004 not found!")
        return

    # Load real route geometry
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        fix = json.load(f)

    # Clean up previous demo trips with this source name
    await db.trips.delete_many({"source.name": "Devanahalli Central"})

    # Depart tomorrow at 09:00 UTC / 14:30 IST
    depart_time = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    day_str = depart_time.strftime("%Y-%m-%d")

    trip_doc = {
        "driver_id": drv_id,
        "vehicle_id": veh_id,
        "source": {
            "name": "Devanahalli Central",
            "point": {"type": "Point", "coordinates": DEV},
        },
        "destination": {
            "name": "Hebbal Flyover",
            "point": {"type": "Point", "coordinates": HEB},
        },
        "route_geometry": fix["geometry"],
        "distance_km": fix["distance_km"],
        "duration_min": fix["duration_min"],
        "depart_at": depart_time,
        "seats_offered": 4,      # 4 passenger seats offered in 4+1 vehicle
        "seats_booked": 0,       # 0 booked initially
        "status": "published",
        "trip_type": "live",
        "fuel_type": "diesel",
        "fuel_price": 95.0,
        "created_at": now,
        "updated_at": now,
    }
    trip_id = (await db.trips.insert_one(trip_doc)).inserted_id
    print(f"Created Demo Trip {trip_id}: Devanahalli -> Hebbal, 4 seats offered")

    # 3. Simulate Passenger login and ride search
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Driver token
        r_drv_login = await ac.post("/api/v1/auth/login", json={"phone": "+919000000002", "password": "pass1234"})
        drv_tok = r_drv_login.json()["access_token"]

        # Passenger token
        r_pax_login = await ac.post("/api/v1/auth/login", json={"phone": "+919000000004", "password": "pass1234"})
        pax_tok = r_pax_login.json()["access_token"]

        # Passenger searches Yelahanka -> Hebbal
        q = {
            "src_coordinates": YEL,
            "dst_coordinates": HEB,
            "date": day_str,
            "time": "09:00",
            "seats": 1,
            "include_excluded": True,
        }
        res_search = await ac.post("/api/v1/search/rides", json=q, headers={"Authorization": "Bearer " + pax_tok})
        assert res_search.status_code == 200, res_search.text
        search_data = res_search.json()
        print(f"\n[PASSENGER SEARCH] Found {search_data['count']} matching trip(s)")
        matched_trip = search_data["results"][0]
        print(f"  Matched Trip ID: {matched_trip['id']}")
        print(f"  Driver: {drv.get('full_name')} (+919000000002)")
        print(f"  Trip: {matched_trip['source_name']} -> {matched_trip['destination_name']}")
        print(f"  Passenger Ride Distance: {matched_trip.get('passenger_distance_km')} km (Driver total: {matched_trip.get('distance_km')} km)")
        print(f"  Driver Detour: {matched_trip.get('detour_km')} km")
        print(f"  Pickup Point: {matched_trip.get('pickup')}")
        print(f"  Seats available before order: {matched_trip.get('seats_left')} / {matched_trip.get('seats_offered')}")
        print(f"  Estimated Contribution: Rs {matched_trip.get('estimated_contribution')}")

        # 4. Passenger orders/books 1 seat
        print("\n[ORDERING RIDE] Passenger +919000000004 requests 1 seat...")
        booking_payload = {
            "trip_id": str(trip_id),
            "seats": 1,
            "pickup_coordinates": YEL,
            "dropoff_coordinates": HEB,
            "use_optimised_pickup": True,
        }
        res_book = await ac.post("/api/v1/bookings", json=booking_payload, headers={"Authorization": "Bearer " + pax_tok})
        assert res_book.status_code == 201, res_book.text
        booking_data = res_book.json()
        booking_id = booking_data["id"]
        print(f"  Booking Created! Booking ID: {booking_id}, Status: {booking_data['status']}")
        print(f"  Seats reserved: {booking_data['seats']}")

        # 5. Driver accepts the booking
        res_accept = await ac.post(f"/api/v1/bookings/{booking_id}/accept", headers={"Authorization": "Bearer " + drv_tok})
        assert res_accept.status_code == 200, res_accept.text
        print(f"  Driver +919000000002 accepted the booking! Status: {res_accept.json()['status']}")

        # 6. Verify Remaining Seats on Trip
        updated_trip = await db.trips.find_one({"_id": trip_id})
        seats_offered = updated_trip["seats_offered"]
        seats_booked = updated_trip["seats_booked"]
        seats_available = seats_offered - seats_booked

        print("\n========================================================")
        print("DEMO TRIP SEAT AVAILABILITY SUMMARY:")
        print(f"  Vehicle Capacity: 4 + 1 (4 Passenger Seats + 1 Driver)")
        print(f"  Seats Offered:    {seats_offered}")
        print(f"  Passenger Orders: {seats_booked} (Passenger +919000000004 booked 1 seat)")
        print(f"  REMAINING SEATS:  {seats_available} SEATS AVAILABLE!")
        print("========================================================")

        # 7. Check availability endpoint for passengers
        avail = await ac.get("/api/v1/trips/available?destination=Hebbal", headers={"Authorization": "Bearer " + pax_tok})
        assert avail.status_code == 200
        avail_list = avail.json()
        our_avail = next((t for t in avail_list if t["id"] == str(trip_id)), None)
        if our_avail:
            print(f"Passenger Dashboard Availability API confirms:")
            print(f"  Trip: {our_avail['source_name']} -> {our_avail['destination_name']}")
            print(f"  Seats Left: {our_avail['seats_left']} / {our_avail['seats_offered']}")
            print(f"  Vehicle: {our_avail.get('vehicle', {}).get('make')} {our_avail.get('vehicle', {}).get('model')} ({our_avail.get('vehicle', {}).get('plate_no')})")
        print("SUCCESS! Demo trip and order workflow completed successfully.")

if __name__ == "__main__":
    asyncio.run(main())
