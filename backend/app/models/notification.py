"""Notification shapes (Module 23).

In-app only: the project ships no email/SMS provider, so this is a read-mark
feed served over polling. `NotificationOut` carries `action` so the bell can
deep-link into the ride, the live view, or the Module 22 rating prompt without
the frontend hard-coding a per-type rule.
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    priority: str = "normal"  # low | normal | high | critical
    action: Optional[str] = None      # rate | live | None
    trip_id: Optional[str] = None
    booking_id: Optional[str] = None
    read_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class NotificationFeed(BaseModel):
    count: int
    unread: int
    critical: int
    by_type: dict = Field(default_factory=dict)
    items: List[NotificationOut] = Field(default_factory=list)