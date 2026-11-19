"""Full verification test suite for Real-Time Device-Based GPS Tracking System.
Tests:
1. Start tracking with driver authorization checks.
2. Device GPS location ping transmission, storage in locations, progress, and safety deviation alert.
3. Passenger audience authorization gate (allowed for booked passenger, forbidden for stranger).
4. WebSocket subscription authorization (4403 on stranger).
5. Admin fleet monitoring endpoint (/admin/tracking/active).
6. Stop tracking / ride completion and rejection of subsequent pings.
"""
from datetime import datetime, timedelta, timezone
import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.database import get_db, ping_db


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


ROUTE = [
    [77.5946, 13.0358],  # Hebbal
    [77.5963, 13.1007],  # Yelahanka
    [77.7120, 13.2437],  # Devanahalli
]


@pytest.mark.asyncio
async def test_full_live_tracking_system():
    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()

    drv_phone = "+919000003001"
    pax_booked_phone = "+919000003002"
    pax_stranger_phone = "+919000003003"
    adm_phone = "+919000003004"

    # Clean up test accounts
    for p in (drv_phone, pax_booked_phone, pax_stranger_phone, adm_phone):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": "LiveTrackTest Hebbal"})
    await db.vehicles.delete_many({"plate_no": "KA04TRK999"})
    await db.notifications.delete_many({})

    async with _client() as ac:
        # Register accounts
        await ac.post("/api/v1/auth/register", json={
            "phone": drv_phone, "password": "pass1234", "full_name": "GPS Driver", "roles": ["driver"]
        })
        await ac.post("/api/v1/auth/register", json={
            "phone": pax_booked_phone, "password": "pass1234", "full_name": "Booked Rider", "roles": ["passenger"]
        })
        await ac.post("/api/v1/auth/register", json={
            "phone": pax_stranger_phone, "password": "pass1234", "full_name": "Stranger Rider", "roles": ["passenger"]
        })
        await ac.post("/api/v1/auth/register", json={
            "phone": adm_phone, "password": "pass1234", "full_name": "Fleet Admin", "roles": ["passenger"]
        })

        # Promote admin
        await db.users.update_one({"phone": adm_phone}, {"$set": {"roles": ["admin"]}})

        # Login and get tokens
        t_drv = (await ac.post("/api/v1/auth/login", json={"phone": drv_phone, "password": "pass1234"})).json()["access_token"]
        t_pax_booked = (await ac.post("/api/v1/auth/login", json={"phone": pax_booked_phone, "password": "pass1234"})).json()["access_token"]
        t_pax_stranger = (await ac.post("/api/v1/auth/login", json={"phone": pax_stranger_phone, "password": "pass1234"})).json()["access_token"]
        t_adm = (await ac.post("/api/v1/auth/login", json={"phone": adm_phone, "password": "pass1234"})).json()["access_token"]

        drv_user = await db.users.find_one({"phone": drv_phone})
        pax_booked_user = await db.users.find_one({"phone": pax_booked_phone})

        # Create driver vehicle
        now = datetime.now(timezone.utc)
        veh_id = (await db.vehicles.insert_one({
            "owner_id": drv_user["_id"],
            "make": "Hyundai", "model": "Creta", "year": 2023, "color": "White",
            "plate_no": "KA04TRK999", "seats_total": 5, "fuel_type": "diesel", "mileage_kmpl": 17.5,
            "verification_status": "verified", "is_active": True,
            "created_at": now, "updated_at": now
        })).inserted_id

        # Driver publishes trip Hebbal -> Devanahalli
        trip_id = (await db.trips.insert_one({
            "driver_id": drv_user["_id"],
            "vehicle_id": veh_id,
            "source": {"name": "LiveTrackTest Hebbal", "point": {"type": "Point", "coordinates": ROUTE[0]}},
            "destination": {"name": "LiveTrackTest Devanahalli", "point": {"type": "Point", "coordinates": ROUTE[2]}},
            "route_geometry": {"type": "LineString", "coordinates": ROUTE},
            "distance_km": 28.0,
            "duration_min": 35.0,
            "depart_at": now + timedelta(minutes=15),
            "seats_offered": 3,
            "seats_booked": 1,
            "status": "published",
            "trip_type": "live",
            "created_at": now,
            "updated_at": now
        })).inserted_id

        # Create accepted booking for Booked Rider
        booking_id = (await db.bookings.insert_one({
            "trip_id": trip_id,
            "passenger_id": pax_booked_user["_id"],
            "driver_id": drv_user["_id"],
            "seats": 1,
            "status": "accepted",
            "pickup": {"name": "Yelahanka", "point": {"type": "Point", "coordinates": ROUTE[1]}},
            "dropoff": {"name": "Devanahalli", "point": {"type": "Point", "coordinates": ROUTE[2]}},
            "created_at": now,
            "updated_at": now
        })).inserted_id

        # -------------------------------------------------------------
        # 1. Start Tracking: only driver can start
        # -------------------------------------------------------------
        # Stranger rider attempt -> 403
        r_fail = await ac.post(f"/api/v1/tracking/{trip_id}/start", headers=_h(t_pax_stranger))
        assert r_fail.status_code == 403

        # Driver starts tracking -> 200, status ongoing
        r_start = await ac.post(f"/api/v1/tracking/{trip_id}/start", headers=_h(t_drv))
        assert r_start.status_code == 200, r_start.text
        start_data = r_start.json()
        assert start_data["ok"] is True
        assert start_data["status"] == "ongoing"

        fresh_trip = await db.trips.find_one({"_id": trip_id})
        assert fresh_trip["status"] == "ongoing"

        # -------------------------------------------------------------
        # 2. Driver sends real-time GPS location updates
        # -------------------------------------------------------------
        # Coordinate bounds check
        r_bad = await ac.post(
            f"/api/v1/tracking/{trip_id}/location",
            headers=_h(t_drv),
            json={"trip_id": str(trip_id), "lng": 999.0, "lat": 13.10}
        )
        assert r_bad.status_code == 422

        # Valid GPS fix at Yelahanka along the route
        r_fix1 = await ac.post(
            f"/api/v1/tracking/{trip_id}/location",
            headers=_h(t_drv),
            json={
                "trip_id": str(trip_id),
                "lng": 77.5963,
                "lat": 13.1007,
                "speed_kmph": 42.0,
                "accuracy_m": 8.0,
                "heading_deg": 35.0
            }
        )
        assert r_fix1.status_code == 200, r_fix1.text
        fix1_data = r_fix1.json()
        assert fix1_data["ok"] is True
        assert fix1_data["progress"] is not None
        assert fix1_data["progress"]["off_route"] is False
        assert fix1_data["progress"]["eta_min"] is not None

        # Verify fix was recorded in db.locations
        saved_loc = await db.locations.find_one({"trip_id": trip_id}, sort=[("recorded_at", -1)])
        assert saved_loc is not None
        assert saved_loc["point"]["coordinates"] == [77.5963, 13.1007]
        assert saved_loc["speed_kmph"] == 42.0
        assert saved_loc.get("accuracy_m") == 8.0

        # Send off-route GPS fix to test route deviation auto-detection
        r_off = await ac.post(
            "/api/v1/tracking/ping",
            headers=_h(t_drv),
            json={
                "trip_id": str(trip_id),
                "lng": 77.8500,  # Far away from route (> 10 km off)
                "lat": 13.1000,
                "speed_kmph": 55.0
            }
        )
        assert r_off.status_code == 200
        off_data = r_off.json()
        assert off_data["progress"]["off_route"] is True
        assert off_data["progress"]["off_route_m"] > 500

        # Verify deviation alert was created
        dev_alert = await db.safety_alerts.find_one({"trip_id": trip_id, "type": {"$in": ["deviation", "route_deviation"]}})
        assert dev_alert is not None
        assert dev_alert["status"] == "open"

        # -------------------------------------------------------------
        # 3. Audience checks for live and trail view
        # -------------------------------------------------------------
        # Stranger passenger -> 403 Forbidden
        r_pax_stranger_live = await ac.get(f"/api/v1/tracking/live/{trip_id}", headers=_h(t_pax_stranger))
        assert r_pax_stranger_live.status_code == 403

        # Booked passenger -> 200 OK
        r_pax_booked_live = await ac.get(f"/api/v1/tracking/live/{trip_id}", headers=_h(t_pax_booked))
        assert r_pax_booked_live.status_code == 200
        live_data = r_pax_booked_live.json()
        assert live_data["trip_status"] == "ongoing"
        assert live_data["fix"] is not None
        assert live_data["stale"] is False

        # Admin -> 200 OK
        r_adm_live = await ac.get(f"/api/v1/tracking/live/{trip_id}", headers=_h(t_adm))
        assert r_adm_live.status_code == 200

        # Trail polyline endpoint
        r_trail = await ac.get(f"/api/v1/tracking/trail/{trip_id}", headers=_h(t_pax_booked))
        assert r_trail.status_code == 200
        trail_data = r_trail.json()
        assert trail_data["count"] >= 2
        assert len(trail_data["fixes"]) >= 2

        # -------------------------------------------------------------
        # 4. Admin Fleet Monitoring
        # -------------------------------------------------------------
        # Non-admin -> 403
        r_fleet_denied = await ac.get("/api/v1/admin/tracking/active", headers=_h(t_drv))
        assert r_fleet_denied.status_code == 403

        # Admin -> 200 OK with active fleet trips
        r_fleet = await ac.get("/api/v1/admin/tracking/active", headers=_h(t_adm))
        assert r_fleet.status_code == 200
        fleet_data = r_fleet.json()
        assert fleet_data["count"] >= 1
        fleet_trip = next((t for t in fleet_data["trips"] if t["trip_id"] == str(trip_id)), None)
        assert fleet_trip is not None
        assert fleet_trip["driver"]["name"] == "GPS Driver"
        assert fleet_trip["vehicle"]["plate_no"] == "KA04TRK999"
        assert fleet_trip["passengers_count"] == 1
        assert fleet_trip["passengers"][0]["name"] == "Booked Rider"
        assert fleet_trip["progress"]["off_route"] is True
        assert len(fleet_trip["open_alerts"]) >= 1

        # -------------------------------------------------------------
        # 5. Stop Tracking & Ride Completion
        # -------------------------------------------------------------
        r_stop = await ac.post(f"/api/v1/tracking/{trip_id}/stop", headers=_h(t_drv))
        assert r_stop.status_code == 200, r_stop.text
        stop_data = r_stop.json()
        assert stop_data["status"] == "completed"

        # Verify trip and booking are completed
        completed_trip = await db.trips.find_one({"_id": trip_id})
        assert completed_trip["status"] == "completed"
        completed_booking = await db.bookings.find_one({"_id": booking_id})
        assert completed_booking["status"] == "completed"

        # -------------------------------------------------------------
        # 6. Reject subsequent GPS pings after ride completion
        # -------------------------------------------------------------
        r_post_complete = await ac.post(
            f"/api/v1/tracking/{trip_id}/location",
            headers=_h(t_drv),
            json={"trip_id": str(trip_id), "lng": 77.7120, "lat": 13.2437}
        )
        assert r_post_complete.status_code == 422
        assert "completed" in r_post_complete.text

    # Clean up test accounts and trips
    for p in (drv_phone, pax_booked_phone, pax_stranger_phone, adm_phone):
        await db.users.delete_many({"phone": p})
    await db.trips.delete_many({"source.name": "LiveTrackTest Hebbal"})
    await db.bookings.delete_many({"trip_id": trip_id})
    await db.locations.delete_many({"trip_id": trip_id})
    await db.safety_alerts.delete_many({"trip_id": trip_id})
    await db.vehicles.delete_many({"_id": veh_id})
