"""locations (trip-scoped GPS, TTL 30d) + safety_alerts (Modules 17-20)."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.common import GeoPoint, utcnow


class LocationDoc(BaseModel):
    trip_id: str
    actor_id: str  # driver only; enforced at route layer (Module 17)
    point: GeoPoint
    speed_kmph: Optional[float] = Field(default=None, ge=0, le=300)
    recorded_at: datetime = Field(default_factory=utcnow)


class SafetyAlertDoc(BaseModel):
    trip_id: str
    booking_id: Optional[str] = None
    type: str  # sos | speed | deviation
    severity: str = "medium"  # low | medium | high | critical
    point: Optional[GeoPoint] = None
    details: Optional[dict] = None
    status: str = "open"  # open | acknowledged | resolved
    created_at: datetime = Field(default_factory=utcnow)
    resolved_at: Optional[datetime] = None
