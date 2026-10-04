"""Live streaming (Module 20): WebSocket fan-out for a trip.

Replaces Module 17's 10-second polling with push, using the SAME audience rule
and the SAME write path so nothing can drift:

    WS  /api/v1/stream/trips/{trip_id}?token=<jwt>
    GET /api/v1/stream/stats

SERVER -> CLIENT
    {"type":"hello", ...}   full state on connect (or reconnect)
    {"type":"state", ...}   heartbeat snapshot, only when something changed
    {"type":"fix", ...}     immediate push after any driver ping
    {"type":"alert", ...}   immediate push for a new Module 18 alert
    {"type":"ack"|"pong"|"error", ...}

CLIENT -> SERVER
    {"type":"ping", "lng":.., "lat":.., "speed_kmph":..}   driver only
    {"type":"sync"}     ask for a full snapshot
    {"type":"ping_me"}  keepalive

WHY a token query param: browsers cannot set an Authorization header on a
WebSocket handshake. The token is verified exactly like the HTTP path
(signature + account still active), and the audience gate is Module 17's
`_assert_audience` — the socket grants no new visibility.

HEARTBEAT: after HEARTBEAT_S of silence the server re-reads the DB, so a ping
that arrived over plain HTTP (or from another process) still reaches watchers.
Push is the fast path; the heartbeat is the correctness net.
"""
import asyncio
import json
import logging
from typing import Dict, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from app.api.v1.tracking import (
    _assert_audience,
    _live_row,
    record_ping,
)
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import decode_token
from app.services.hub import HEARTBEAT_S, hub, json_safe

router = APIRouter(prefix="/stream", tags=["stream"])

logger = logging.getLogger("voltride.stream")

WS_UNAUTHORIZED = 4401
WS_FORBIDDEN = 4403
WS_CLOSED = 4400


async def _ws_user(token: Optional[str]) -> Optional[Dict]:
    """JWT -> live session dict. Mirrors core.deps.get_current_user."""
    if not token:
        return None
    try:
        payload = decode_token(token)
    except ValueError:
        return None
    uid = payload.get("sub")
    if not uid or not ObjectId.is_valid(uid):
        return None
    db = get_db()
    user = await db.users.find_one({"_id": ObjectId(uid)})
    if user is None or user.get("status") != "active":
        return None
    return {"id": str(user["_id"]), "phone": user["phone"],
            "full_name": user.get("full_name", ""),
            "roles": user.get("roles", []),
            "phone_verified": bool(user.get("phone_verified", False))}


async def _snapshot(db, trip: Dict, user: Dict) -> Dict:
    """Current truth for the socket: latest fix, progress, open alerts."""
    fix = await db.locations.find_one({"trip_id": trip["_id"]},
                                      sort=[("recorded_at", -1)])
    alerts = await db.safety_alerts.count_documents(
        {"trip_id": trip["_id"], "status": "open"})
    row = _live_row(trip, fix)
    row.pop("message", None)
    row["open_alerts"] = alerts
    row["viewer_id"] = user["id"]
    row["is_driver"] = str(trip["driver_id"]) == user["id"]
    row["watchers"] = hub.subscriber_count(str(trip["_id"]))
    return row


def _signature(snap: Dict) -> tuple:
    """What makes a snapshot worth re-sending (cheap change detection)."""
    fix = snap.get("fix") or {}
    return (fix.get("recorded_at"), snap.get("trip_status"),
            snap.get("open_alerts"))


async def _send(websocket: WebSocket, payload: Dict) -> None:
    """Every frame goes through here so no path can bypass json_safe().

    A raw `datetime`/`ObjectId` reaching `send_json` raises, and on the hub
    path that would silently unsubscribe every watcher (see services/hub.py).
    """
    await websocket.send_json(json_safe(payload))


def _bad_coords(msg: Dict) -> Optional[str]:
    try:
        lng = float(msg["lng"])
        lat = float(msg["lat"])
    except (KeyError, TypeError, ValueError):
        return "ping needs numeric lng/lat"
    if not (-180 <= lng <= 180) or not (-90 <= lat <= 90):
        return "coordinates out of range"
    return None


async def _handle_message(websocket: WebSocket, db, trip: Dict, user: Dict,
                          msg: Dict, key: str):
    """One inbound frame. Returns the new snapshot signature when the world
    changed (so the heartbeat does not re-send it), else None."""
    kind = msg.get("type")
    if kind == "ping_me":
        await _send(websocket, {"type": "pong"})
        return None
    if kind == "sync":
        snap = await _snapshot(db, trip, user)
        await _send(websocket, {"type": "state", **snap})
        return _signature(snap)
    if kind != "ping":
        await _send(websocket, {"type": "error",
                                   "detail": "unknown type: " + str(kind)})
        return None

    # --- driver ping over the socket (same core as HTTP /tracking/ping) -----
    if str(trip["driver_id"]) != user["id"]:
        await _send(websocket, {"type": "error",
                                   "detail": "only the driver shares live location"})
        return None
    if trip.get("status") not in ("published", "ongoing"):
        await _send(websocket, {"type": "error",
                                   "detail": "trip is " + str(trip.get("status"))
                                             + " — no tracking"})
        return None
    bad = _bad_coords(msg)
    if bad:
        await _send(websocket, {"type": "error", "detail": bad})
        return None
    speed = msg.get("speed_kmph")
    if speed is not None:
        try:
            speed = float(speed)
        except (TypeError, ValueError):
            speed = None
    if speed is not None and not (0 <= speed <= 300):
        await _send(websocket, {"type": "error",
                                   "detail": "speed out of range"})
        return None

    out = await record_ping(db, trip, user["id"], float(msg["lng"]),
                            float(msg["lat"]), speed)
    await _send(websocket, {"type": "ack", "trip_status": out["trip_status"],
                              "started": out["started"],
                              "progress": out["progress"],
                              "pushed_to": out.get("pushed_to", 0),
                              "alerts": out.get("alerts", [])})
    return _signature(await _snapshot(db, trip, user))



@router.get("/stats")
async def stream_stats(user: Dict = Depends(get_current_user)):
    """Hub introspection (any login): proves the push path during the demo."""
    _ = user
    return {"hub": hub.stats(), "heartbeat_s": HEARTBEAT_S,
            "trips": hub.trips_with_subscribers()}


@router.websocket("/trips/{trip_id}")
async def trip_socket(websocket: WebSocket, trip_id: str,
                      token: Optional[str] = Query(default=None)):
    """Push channel scoped to one trip. Closes 4401/4403 on auth/audience."""
    user = await _ws_user(token)
    if user is None:
        await websocket.close(code=WS_UNAUTHORIZED)
        return
    if not ObjectId.is_valid(trip_id):
        await websocket.close(code=WS_CLOSED)
        return
    db = get_db()
    trip = await db.trips.find_one({"_id": ObjectId(trip_id)})
    if trip is None:
        await websocket.close(code=WS_CLOSED)
        return
    try:
        await _assert_audience(db, trip, user)
    except Exception:
        await websocket.close(code=WS_FORBIDDEN)
        return

    await websocket.accept()
    key = str(trip["_id"])
    watchers = await hub.subscribe(key, websocket)
    snap = await _snapshot(db, trip, user)
    last_sig = _signature(snap)
    await _send(websocket, {"type": "hello", "watchers": watchers,
                              "heartbeat_s": HEARTBEAT_S, **snap})
    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(),
                                             timeout=HEARTBEAT_S)
            except asyncio.TimeoutError:
                fresh = await db.trips.find_one({"_id": trip["_id"]})
                if fresh is not None:
                    trip = fresh
                snap = await _snapshot(db, trip, user)
                sig = _signature(snap)
                if sig != last_sig:
                    last_sig = sig
                    await _send(websocket, {"type": "state", **snap})
                continue

            try:
                msg = json.loads(raw)
                if not isinstance(msg, dict):
                    raise ValueError("expected an object")
            except ValueError:
                await _send(websocket, {"type": "error",
                                           "detail": "malformed JSON"})
                continue
            new_sig = await _handle_message(websocket, db, trip, user, msg, key)
            if new_sig is not None:
                last_sig = new_sig
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("stream socket failed for trip %s", key)
        try:
            await websocket.close(code=WS_CLOSED)
        except Exception:
            pass
    finally:
        await hub.unsubscribe(key, websocket)


