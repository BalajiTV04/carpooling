"""FastAPI entrypoint.

- CORS locked to frontend origin(s) from Settings (Module 3 tightens this).
- Single versioned mount: app includes v1 router under API_V1_PREFIX.
- `ping_db` is intentionally NOT called at startup so `uvicorn` boots even
  when Mongo is down; /health reports disconnected instead of crashing, and
  /ready (Module 25) is the probe a load balancer or compose should use.
- Module 25: when APP_ENV=production the process REFUSES to start on an unsafe
  configuration (dev JWT secret, empty/plain-http CORS). In development the
  guard is a no-op, so the test suite and local work are unaffected.
- Security headers are applied to every response (X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security in prod).
- Rate limiting guards auth/OTP endpoints (5 requests per minute per IP).
"""
import time
from collections import defaultdict
from typing import Callable, Dict, List, Tuple

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.router import router as v1_router
from app.core.config import get_settings, is_production, validate_production

settings = get_settings()

if is_production(settings):
    _problems = validate_production(settings)
    if _problems:
        raise RuntimeError(
            "Refusing to start with APP_ENV=production:\n  - "
            + "\n  - ".join(_problems))
    _missing: List[str] = []
    if not settings.MONGO_URI:
        _missing.append("MONGO_URI")
    if not settings.JWT_SECRET or settings.JWT_SECRET in (
        "change-me-in-dev-only-min-32-chars", ""):
        _missing.append("JWT_SECRET")
    if not settings.CORS_ORIGINS:
        _missing.append("CORS_ORIGINS")
    if _missing:
        raise RuntimeError(
            "Refusing to start with APP_ENV=production: missing required "
            "env vars: " + ", ".join(_missing))

app = FastAPI(title=settings.APP_NAME, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        if is_production(settings):
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains")
        return response


app.add_middleware(SecurityHeadersMiddleware)

# --- Rate limiting for auth/OTP endpoints (in-memory sliding window) ---
_RATE_WINDOW_SEC = 60
_RATE_MAX = 5
_rate_records: Dict[Tuple[str, str], List[float]] = defaultdict(list)

_AUTH_PATHS = {
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/otp/request",
    "/api/v1/auth/otp/verify",
}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window rate limiter for auth endpoints."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if path not in _AUTH_PATHS:
            return await call_next(request)
        # Rate limiting is a production-only guard; dev and tests are exempt.
        if not is_production(settings):
            return await call_next(request)

        client = request.client
        ip = client.host if client else "unknown"
        key = (ip, path)
        now = time.time()

        window_start = now - _RATE_WINDOW_SEC
        _rate_records[key] = [t for t in _rate_records[key] if t > window_start]

        if len(_rate_records[key]) >= _RATE_MAX:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
            )

        _rate_records[key].append(now)
        return await call_next(request)


app.add_middleware(RateLimitMiddleware)

app.include_router(v1_router, prefix=settings.API_V1_PREFIX)


@app.get("/", include_in_schema=False)
async def root():
    return {"service": settings.APP_NAME, "docs": "/docs", "health": f"{settings.API_V1_PREFIX}/health"}
