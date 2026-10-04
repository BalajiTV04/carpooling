"""FastAPI entrypoint.

- CORS locked to frontend origin(s) from Settings (Module 3 tightens this).
- Single versioned mount: app includes v1 router under API_V1_PREFIX.
- `ping_db` is intentionally NOT called at startup so `uvicorn` boots even
  when Mongo is down; /health reports disconnected instead of crashing, and
  /ready (Module 25) is the probe a load balancer or compose should use.
- Module 25: when APP_ENV=production the process REFUSES to start on an unsafe
  configuration (dev JWT secret, empty/plain-http CORS). In development the
  guard is a no-op, so the test suite and local work are unaffected.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.core.config import get_settings, is_production, validate_production

settings = get_settings()

if is_production(settings):
    _problems = validate_production(settings)
    if _problems:
        raise RuntimeError(
            "Refusing to start with APP_ENV=production:\n  - "
            + "\n  - ".join(_problems))

app = FastAPI(title=settings.APP_NAME, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router, prefix=settings.API_V1_PREFIX)


@app.get("/", include_in_schema=False)
async def root():
    return {"service": settings.APP_NAME, "docs": "/docs", "health": f"{settings.API_V1_PREFIX}/health"}
