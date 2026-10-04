"""Motor (async MongoDB) client helpers.

Module 1 wires the connection only; Module 2 creates collections + 2dsphere
indexes. Every route module will `get_db()` instead of opening its own client,
so connection pooling stays in one place.

Loop safety: pytest-asyncio (strict mode) runs each async test on a FRESH
event loop, but a Motor client pins to the loop that created it. Reusing one
global client across tests therefore hits "Event loop is closed". We track
the owning loop and rebuild the client when the loop changes or dies, with
one retry in ping_db so health checks never crash the app.
"""
import asyncio
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

_client: Optional[AsyncIOMotorClient] = None
_client_loop = None


def _current_loop():
    try:
        return asyncio.get_event_loop()
    except RuntimeError:
        return None


def get_client() -> AsyncIOMotorClient:
    global _client, _client_loop
    loop = _current_loop()
    # Rebuild when: first use, loop rotated (tests), or old loop closed.
    if _client is None or (
        loop is not None and _client_loop is not None and _client_loop is not loop
    ):
        try:
            if _client is not None:
                _client.close()
        except Exception:
            pass
        _client = AsyncIOMotorClient(get_settings().MONGO_URI)
        _client_loop = loop
    elif _client_loop is not None:
        try:
            if _client_loop.is_closed():
                _client = AsyncIOMotorClient(get_settings().MONGO_URI)
                _client_loop = loop
        except Exception:
            pass
    if _client_loop is None:
        _client_loop = loop
    return _client


def reset_client() -> None:
    """Forget the cached client (tests call this to force a fresh connect)."""
    global _client, _client_loop
    try:
        if _client is not None:
            _client.close()
    except Exception:
        pass
    _client = None
    _client_loop = None


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[get_settings().MONGO_DB]


async def ping_db() -> bool:
    """Return True when Mongo answers. Retries once on a fresh client; never raises."""
    try:
        await get_client().admin.command("ping")
        return True
    except Exception:
        pass
    try:  # stale loop/client suspected — rebuild once and retry
        reset_client()
        await get_client().admin.command("ping")
        return True
    except Exception:
        return False
