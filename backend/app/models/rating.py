"""Rating shapes (Module 22).

Bounds are literals here on purpose: Pydantic is the validation boundary, and
`app/models/` stays a leaf module (it never imports `app/services/`). The
canonical MIN_STARS/MAX_STARS live in services.ratings, and test_ratings
asserts the two agree so they cannot drift apart.

One rating per (booking, rater) is enforced by a unique index, not by the
model — re-posting the same booking updates that rater's existing score.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class RatingIn(BaseModel):
    booking_id: str
    stars: int = Field(ge=1, le=5)  # == services.ratings.MIN_STARS/MAX_STARS
    comment: Optional[str] = Field(default=None, max_length=500)  # MAX_COMMENT


class RatingOut(BaseModel):
    id: str
    booking_id: str
    trip_id: str
    rater_id: str
    target_id: str
    stars: int
    comment: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    rater_name: Optional[str] = None
    target_name: Optional[str] = None
    # The target's recomputed aggregate, so the UI updates in place after a
    # write instead of guessing (the same numbers profile.py will serve next).
    target_rating_avg: Optional[float] = None
    target_rating_count: int = 0


class RatingCard(BaseModel):
    """What GET /ratings/user/{id} returns: the aggregate plus recent reviews."""

    user_id: str
    full_name: Optional[str] = None
    roles: list = Field(default_factory=list)
    rating_avg: Optional[float] = None
    rating_count: int = 0
    distribution: dict = Field(default_factory=dict)
    items: list = Field(default_factory=list)