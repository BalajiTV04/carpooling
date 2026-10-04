"""Auth dependencies: load current user from JWT + enforce roles.

Pattern every protected module reuses (trips/bookings/tracking/admin):

    from app.core.deps import get_current_user, require_roles

    @router.get("/me")
    async def me(user: dict = Depends(get_current_user)): ...

    @router.post("/driver-only")
    async def x(user: dict = Depends(require_roles("driver"))): ...

Why a dict, not a model? Keeps the dep light: routes get id/phone/roles and
fetch the full user doc only when they need it (profile update, etc.).
"""
from typing import Callable, Dict, List, Optional

from bson import ObjectId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import get_db
from app.core.security import decode_token

_bearer = HTTPBearer(auto_error=False)


def _unauth(detail: str = "not authenticated") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _forbidden(detail: str = "forbidden for your role") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Dict:
    """Decode JWT -> fetch live user doc -> return slim session dict.

    Checks `status == active` on every call so a suspended user loses access
    immediately (no waiting for token expiry). This is the safety hook your
    priority principle needs: safety/admin actions take effect at once.
    """
    if creds is None or not creds.credentials:
        raise _unauth()
    try:
        payload = decode_token(creds.credentials)
    except ValueError:
        raise _unauth("invalid or expired token")
    user_id = payload.get("sub")
    if not user_id or not ObjectId.is_valid(user_id):
        raise _unauth()
    db = get_db()
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if user is None:
        raise _unauth("account not found")
    if user.get("status") != "active":
        raise _forbidden("account suspended")
    return {
        "id": str(user["_id"]),
        "phone": user["phone"],
        "full_name": user.get("full_name", ""),
        "roles": user.get("roles", []),
        "phone_verified": bool(user.get("phone_verified", False)),
    }


def require_roles(*allowed: str) -> Callable:
    """Gate: user must hold at least one of the allowed roles."""
    allowed_set = set(allowed)

    async def gate(user: Dict = Depends(get_current_user)) -> Dict:
        if not allowed_set.intersection(set(user.get("roles", []))):
            raise _forbidden("requires role: " + "/".join(sorted(allowed_set)))
        return user

    return gate


async def get_optional_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[Dict]:
    """For public endpoints that personalise when logged in (search later)."""
    if creds is None or not creds.credentials:
        return None
    try:
        return await get_current_user(creds)
    except HTTPException:
        return None
