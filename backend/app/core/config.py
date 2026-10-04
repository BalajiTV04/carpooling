"""Single source of truth for backend configuration.

Why this file exists: every module (auth, trips, tracking, safety) reads env
from here via `get_settings()`. Nothing reads os.environ directly, so the
env contract in root .env.example stays honoured and tests can override it.
"""
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

# The shipped development secrets. Module 25 refuses to boot a PRODUCTION
# deploy that still uses one of these — the point is to fail loudly at startup
# rather than quietly run a public demo with a forgeable token.
DEV_JWT_SECRETS = ("change-me-in-dev-only-min-32-chars",)
MIN_JWT_SECRET_LEN = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "Intelligent Vehicle Sharing API"
    # v1 prefix keeps every future module under one versioned namespace.
    API_V1_PREFIX: str = "/api/v1"
    # Module 25: development | production. Only "production" turns on the
    # startup guard below, so dev and the test suite are never affected.
    APP_ENV: str = "development"
    GIT_SHA: str = "dev"  # baked in by the Dockerfile for /version

    MONGO_URI: str = "mongodb://localhost:27017"
    MONGO_DB: str = "vehicle_sharing_dev"

    JWT_SECRET: str = "change-me-in-dev-only-min-32-chars"
    JWT_EXPIRE_MINUTES: int = 10080  # 7 days; phone-OTP sessions reuse this in Module 3

    # Comma-separated list, parsed into a list for CORSMiddleware.
    CORS_ORIGINS: str = "http://localhost:3000"

    # Routing provider switch honoured in Module 7. Default = free OSRM demo.
    ROUTING_PROVIDER: str = "osrm"
    GEOCODER_PROVIDER: str = "nominatim"
    OSRM_URL: str = "https://router.project-osrm.org"
    NOMINATIM_URL: str = "https://nominatim.openstreetmap.org"
    # Nominatim 403s generic/placeholder User-Agents (e.g. one whose contact
    # address is an example.com placeholder), which silently broke geocoding.
    # Override with a real, contactable identifier for your deployment.
    NOMINATIM_USER_AGENT: str = ""

    # Cost engine (Module 12): per-fuel unit prices (₹) + fallbacks.
    FUEL_PRICE_PETROL: float = 104.5
    FUEL_PRICE_DIESEL: float = 95.0
    FUEL_PRICE_CNG: float = 89.0
    FUEL_PRICE_EV: float = 12.0      # ₹ per "unit" (kWh equivalent, documented)
    FUEL_PRICE_HYBRID: float = 95.0  # treated as diesel-equivalent
    DEFAULT_MILEAGE_KMPL: float = 15.0
    DEFAULT_COST_POLICY: str = "split_equal"

    # Advance booking + recurring (Modules 14-15)
    ADVANCE_MAX_DAYS: int = 30        # how far ahead a passenger may book
    ADVANCE_MIN_NOTICE_MIN: int = 60  # latest a booking may be made before departure
    RECURRING_HORIZON_DAYS: int = 21  # how many days of instances we materialise
    RECURRING_MAX_DAYS: int = 90      # hard ceiling for a recurring series

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def validate_production(settings) -> List[str]:
    """Module 25: problems that must block a PRODUCTION boot. Pure.

    Returns a list of human-readable problems — empty means safe to serve.
    Keeping it pure (no raise, no env access of its own) means the rules are
    unit-testable and the caller decides what to do with them.
    """
    problems: List[str] = []
    secret = str(getattr(settings, "JWT_SECRET", "") or "")
    if secret in DEV_JWT_SECRETS:
        problems.append(
            "JWT_SECRET is still the shipped development value — anyone could "
            "forge a token; set a unique random secret")
    elif len(secret) < MIN_JWT_SECRET_LEN:
        problems.append(
            "JWT_SECRET must be at least " + str(MIN_JWT_SECRET_LEN) +
            " characters (is " + str(len(secret)) + ")")
    origins = settings.cors_origin_list
    if not origins:
        problems.append("CORS_ORIGINS is empty — the frontend cannot call the API")
    else:
        for origin in origins:
            if origin.startswith("http://") and "localhost" not in origin \
                    and "127.0.0.1" not in origin:
                problems.append(
                    "CORS origin " + origin + " is plain http; use https outside localhost")
    if str(getattr(settings, "MONGO_DB", "")).strip() == "":
        problems.append("MONGO_DB is empty")
    return problems


def is_production(settings) -> bool:
    return str(getattr(settings, "APP_ENV", "")).strip().lower() == "production"
