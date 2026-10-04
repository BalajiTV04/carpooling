"""Live push hub (Module 20): in-process WebSocket fan-out per trip.

WHY a hub instead of "every socket polls": Module 17 shipped 10-second polling,
which means a passenger can wait up to 10s to see a driver's ping. The hub
makes a ping visible to every watcher *immediately*, and keeps a low-frequency
heartbeat as the safety net for changes that arrive over HTTP (the current
frontend path) or from another process.

SCOPE (stated honestly for the viva): the registry is IN-PROCESS, so it is
correct for a single uvicorn worker — exactly the MVP deployment. Scaling to
multiple workers/replicas needs a shared bus (Redis pub/sub or NATS) behind
`broadcast()`; no caller changes, which is why fan-out lives behind one
function.

Failure discipline: a socket that raises on send is dropped from the registry
(dead connections must never poison a broadcast), and `broadcast()` never
raises — a push failure must not fail the driver's ping that triggered it.
"""
import asyncio
import json
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Set

from bson import ObjectId

# How often a subscriber re-reads the DB when nothing is pushed to it.
HEARTBEAT_S = 5.0


def json_safe(value: Any) -> Any:
    """Convert Mongo/Python values into JSON-serialisable ones, recursively.

    WHY this exists: a WebSocket frame must be pure JSON, while our documents
    carry `datetime` and `ObjectId`. One unserialisable value makes
    `send_json` raise, and because the hub drops sockets that fail to send,
    a single raw datetime silently unsubscribes EVERY watcher (a real bug this
    module hit and now cannot repeat). Normalising in one place means routes
    can hand the hub a natural payload.
    """
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, ObjectId):
        return str(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


class LiveHub:
    """trip_id -> live subscribers. One instance per process (`hub`)."""

    def __init__(self) -> None:
        self._subs: Dict[str, Set[Any]] = {}
        self._lock = asyncio.Lock()
        self.pushed = 0        # counters for the admin console
        self.dropped = 0
        self.last_error: Optional[str] = None

    async def subscribe(self, trip_id: str, ws: Any) -> int:
        async with self._lock:
            self._subs.setdefault(trip_id, set()).add(ws)
            return len(self._subs[trip_id])

    async def unsubscribe(self, trip_id: str, ws: Any) -> int:
        async with self._lock:
            room = self._subs.get(trip_id)
            if room is None:
                return 0
            room.discard(ws)
            if not room:
                self._subs.pop(trip_id, None)
                return 0
            return len(room)

    def subscriber_count(self, trip_id: str) -> int:
        return len(self._subs.get(trip_id, ()))

    def trips_with_subscribers(self) -> List[str]:
        return sorted(self._subs)

    def stats(self) -> Dict:
        return {
            "trips": len(self._subs),
            "sockets": sum(len(v) for v in self._subs.values()),
            "pushed": self.pushed,
            "dropped": self.dropped,
            "last_error": self.last_error,
            "scope": "in-process (single worker); Redis pub/sub is the scale-out path",
        }

    async def broadcast(self, trip_id: str, payload: Dict) -> int:
        """Send to every subscriber of a trip. Returns the delivered count.

        Never raises: a broken socket is unsubscribed instead, and the reason
        is kept in `last_error` so the console can explain a dark push.
        """
        room = list(self._subs.get(trip_id, ()))
        if not room:
            return 0
        payload = json_safe(payload)
        delivered = 0
        for ws in room:
            try:
                await ws.send_json(payload)
                delivered += 1
            except Exception as exc:
                self.dropped += 1
                self.last_error = "{}: {}".format(type(exc).__name__, exc)
                await self.unsubscribe(trip_id, ws)
        self.pushed += delivered
        return delivered


hub = LiveHub()
