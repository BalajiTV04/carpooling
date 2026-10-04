"""Module 25 tests: production config guard, probes, and route-shape smoke tests.

The route tests here are the ones that would have caught the /trips/mine bug:
a literal path declared AFTER a catch-all sibling is unreachable, and FastAPI
gives no warning — it just 404s.
"""
import pytest
from httpx import AsyncClient, ASGITransport

from app.api.v1 import (  # noqa: F401  (imported for the route-shape test)
    admin,
    analytics,
    auth,
    bookings,
    cost,
    db_admin,
    geo,
    health,
    live,
    notifications,
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
from app.core.config import DEV_JWT_SECRETS, MIN_JWT_SECRET_LEN, Settings
from app.core.config import is_production, validate_production
from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


# --------------------------------------------------------------------------
# production configuration guard (pure)
# --------------------------------------------------------------------------

def test_validate_production_flags_the_dev_secret():
    problems = validate_production(Settings(APP_ENV="production"))
    assert any("JWT_SECRET" in p for p in problems)
    assert any("development value" in p for p in problems)
    # the dev settings themselves DO report the problem, but the boot guard is
    # gated on APP_ENV so local work is never blocked
    assert is_production(Settings()) is False
    assert is_production(Settings(APP_ENV="production")) is True


def test_validate_production_flags_short_secret_and_bad_cors():
    short = validate_production(Settings(APP_ENV="production",
                                         JWT_SECRET="short",
                                         CORS_ORIGINS="http://localhost:3000"))
    assert any(str(MIN_JWT_SECRET_LEN) in p for p in short)
    empty = validate_production(Settings(APP_ENV="production",
                                         JWT_SECRET="x" * 40,
                                         CORS_ORIGINS=""))
    assert any("CORS_ORIGINS is empty" in p for p in empty)
    plain = validate_production(Settings(APP_ENV="production",
                                         JWT_SECRET="x" * 40,
                                         CORS_ORIGINS="http://rides.example.com"))
    assert any("plain http" in p for p in plain)


def test_validate_production_passes_a_correct_config():
    good = Settings(APP_ENV="production", JWT_SECRET="k" * 40,
                    CORS_ORIGINS="https://rides.example.com,http://localhost:3000")
    assert validate_production(good) == []
    # multiple origins are allowed as long as every non-localhost one is https
    assert DEV_JWT_SECRETS  # the shipped value is on the deny list

# --------------------------------------------------------------------------
# probes
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ready_and_version_probes():
    from app.core.database import ping_db

    async with _client() as ac:
        r = await ac.get("/api/v1/ready")
        up = await ping_db()
        assert r.status_code == (200 if up else 503)
        assert r.json()["ready"] is up
        assert r.json()["check"] == "mongo ping"

        v = await ac.get("/api/v1/version")
        assert v.status_code == 200
        body = v.json()
        # every key a deployer needs to identify the running build
        for key in ("service", "version", "git_sha", "app_env", "python"):
            assert key in body, key

        # the original liveness probe is unchanged and needs no auth
        h = await ac.get("/api/v1/health")
        assert h.status_code == 200 and h.json()["status"] == "ok"


# --------------------------------------------------------------------------
# route shape: no literal path may be shadowed by a catch-all
# --------------------------------------------------------------------------

def _all_routers():
    mods = [admin, analytics, auth, bookings, cost, db_admin, health, live,
            notifications, pickup, profile, rank, ratings, recurring, safety,
            search, segments, tracking, trips, vehicles]
    out = [(m.__name__.rsplit(".", 1)[-1], m.router) for m in mods]
    out.append(("geo_trips", geo._trips))
    return out


def test_no_literal_route_is_shadowed_by_a_catch_all():
    """FastAPI matches in REGISTRATION order. A literal like /trips/mine
    declared after /trips/{trip_id} is dead code: the catch-all eats it and the
    endpoint 404s with no warning. This bug shipped once in this project."""
    from collections import defaultdict

    groups = defaultdict(list)
    for name, r in _all_routers():
        for idx, route in enumerate(r.routes):
            for method in sorted(getattr(route, "methods", []) or []):
                groups[(name, method)].append((idx, route.path))

    problems = []
    for key, rows in groups.items():
        catch_alls = [(i, p) for i, p in rows if "{" in p]
        if not catch_alls:
            continue
        first_idx, first_path = min(catch_alls)
        depth = first_path.count("/")
        for idx, path in rows:
            if idx > first_idx and "{" not in path and path.count("/") == depth:
                problems.append("%s %s %s is shadowed by %s" % (
                    key[0], key[1], path, first_path))
    assert not problems, "shadowed routes:\n  " + "\n  ".join(problems)


def test_trips_mine_precedes_the_catch_all():
    """The specific regression, named so the failure is obvious."""
    paths = [r.path for r in trips.router.routes]
    assert "/trips/mine" in paths
    assert paths.index("/trips/mine") < paths.index("/trips/{trip_id}")


def test_late_module_routers_are_registered():
    """Modules 22-25 must be on the app; a forgotten include_router would
    otherwise only show up as a 404 in the browser."""
    paths = {r.path for r in app.routes}
    for expected in ("/api/v1/ratings", "/api/v1/ratings/pending",
                     "/api/v1/notifications", "/api/v1/notifications/summary",
                     "/api/v1/analytics/impact", "/api/v1/analytics/demand",
                     "/api/v1/analytics/evaluation", "/api/v1/analytics/me",
                     "/api/v1/ready", "/api/v1/version"):
        assert expected in paths, "missing route " + expected

