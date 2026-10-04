"""v1 router: every future module (auth, trips, bookings, tracking, sos,
admin...) registers its APIRouter here with include_router(...).

Keeping one aggregation point means app/main.py never changes per module.
"""
from fastapi import APIRouter

from app.api.v1 import (
    admin,
    auth,
    bookings,
    cost,
    db_admin,
    geo,
    health,
    live,
    notifications,
    analytics,
    pickup,
    profile,
    rank,
    ratings,
    recurring,
    safety,
    search,
    segments,
    tracking,
    trips,
    vehicles,
)

router = APIRouter()
router.include_router(health.router)
router.include_router(db_admin.router)
router.include_router(auth.router)
router.include_router(profile.router)
router.include_router(vehicles.router)
router.include_router(trips.router)
router.include_router(geo.router)
router.include_router(geo._trips)
router.include_router(search.router)
router.include_router(pickup.router)
router.include_router(bookings.router)
router.include_router(cost.router)
router.include_router(segments.router)
router.include_router(rank.router)
router.include_router(ratings.router)
router.include_router(notifications.router)
router.include_router(analytics.router)
router.include_router(tracking.router)
router.include_router(safety.router)
router.include_router(live.router)
router.include_router(admin.router)
router.include_router(recurring.router)
