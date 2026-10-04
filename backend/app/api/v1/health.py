"""Health probes (Modules 1 + 25): liveness, readiness and build version.

GET /api/v1/health  -> liveness. Always 200 while the process is up, even if
                       Mongo is down, because the frontend renders a
                       Connected/Disconnected pill from it.
GET /api/v1/ready   -> readiness. 200 only when Mongo answers, else 503.
                       THIS is what a Docker healthcheck or load balancer
                       should poll: "can this instance actually serve?"
GET /api/v1/version -> build metadata (GIT_SHA, APP_ENV, python version) so a
                       deployed instance can be identified at a glance.
"""
from fastapi import APIRouter, Response, status

from app.core.config import get_settings
from app.core.database import ping_db

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    settings = get_settings()
    db_ok = await ping_db()
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "db": "connected" if db_ok else "disconnected",
        "routing_provider": settings.ROUTING_PROVIDER,
    }


@router.get("/ready")
async def ready(response: Response):
    """Readiness probe: 503 when the database is unreachable."""
    db_ok = await ping_db()
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "ready": db_ok,
        "db": "connected" if db_ok else "disconnected",
        "check": "mongo ping",
    }


@router.get("/version")
async def version():
    """Which build is running? Baked in by the Dockerfile as GIT_SHA."""
    import platform

    settings = get_settings()
    return {
        "service": settings.APP_NAME,
        "version": "0.1.0",
        "git_sha": settings.GIT_SHA,
        "app_env": settings.APP_ENV,
        "python": platform.python_version(),
    }
