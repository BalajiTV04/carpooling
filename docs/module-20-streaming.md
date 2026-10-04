# Module 20 — Live push streaming (WebSocket fan-out for a trip)

**Status:** VERIFIED · `pytest tests/test_live.py` 6/6 (hub units + json_safe regression + two-socket push flow + HTTP-ping regression) · `lib/live.ts` push client + socket-first `LiveTrack` live.

## 1. Concept / why
Module 17 answered "where is my driver" with 10-second polling — a passenger
could stare at a stale map for up to 10 s. Module 20 replaces polling with
**push**: every driver ping is broadcast to all trip watchers instantly, with
alerts pushed inline. The heartbeat (5 s DB re-read on silence) is the safety
net, not the transport — because pushes can come from HTTP too (the legacy
path), from another process, or from a reconnected client.

## 2. Prerequisites
- Module 17 stream (`locations` + `record_ping` core + audience gate)
- Module 18 `auto_check` (alerts ride the same push)
- websockets 12 + uvicorn 0.33 (already in the stack)

## 3. Push contract
Frames (all pure JSON — see §7 for why this needed enforcing):
- `hello` (full state on connect incl. `watchers`, `open_alerts`, `is_driver`)
- `fix` (immediate, after every driver ping: coordinates + speed + progress)
- `alert` (immediate, per new M18 alert)
- `ack` (driver's own ping confirmation: trip_status/started/progress/pushed_to/alerts)
- `state` (heartbeat snapshot, only when the signature changed)
- `error` (bad input answers here — the socket NEVER drops a client for input)
- inbound: `ping` (driver only), `sync`, `ping_me`

Auth: JWT in `?token=` (browsers can't set WS headers) → same user resolution
as HTTP + the SAME `_assert_audience` gate. 4401 = no/bad session,
4403 = not a party to the trip. The socket grants zero new visibility.

## 4. Code map - how the pieces connect
- `services/hub.py`: `LiveHub` (trip-scoped subscriber registry), `json_safe()`
  (recursive datetime/ObjectId normaliser), `broadcast()` (never raises; dead
  sockets unsubscribed; `last_error` recorded), `stats()`. In-process scope is
  stated on the tin — Redis pub/sub is the named scale-out path.
- `api/v1/live.py`: `WS /stream/trips/{trip_id}` + `GET /stream/stats`
  (introspection for the admin console). `_send()` is the single write path so
  no frame bypasses `json_safe()`; `_handle_message()` keeps inbound logic
  testable; the driver's own socket receives its broadcast too (confirmation).
- `tracking.py`: `record_ping()` is THE single write path shared by HTTP and
  WS; HTTP responses gain `pushed_to` (how many live watchers saw the ping).
- Frontend: `lib/live.ts` (`subscribeTrip` with 4401/4403-aware reconnect —
  permanent rejections never spin), `LiveTrack` socket-first with a 30s poll
  underneath and a push/polling/connecting badge + live alert chip + driver
  ping over the socket with HTTP fallback. `ShareLocation.tsx` deleted (its job
  moved into `LiveTrack`'s `canPing/pingAt`).

## 5. Integration
HTTP and WS share `record_ping` → one audit trail, one auto-start, one alert
dedupe. Admin console (M21) embeds `hub.stats()` for live push observability.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_live.py -v -p no:cacheprovider  # 6 passed
```
Units: hub isolation/trip-scoping, dead-socket drops without raising,
`json_safe` regression, datetime-bearing broadcast. Socket flow (TestClient):
4401/4403 gates, hello×2, driver socket-ping → passenger push (no polling),
speed+deviation double alert on one ping, dedupe repeat → no new alerts, error
frames for bad coords/unknown type, passenger ping refused, keepalive, state.
HTTP regression: `/tracking/ping` contract unchanged.

## 7. Common errors
| Error | Fix |
|---|---|
| frames stop, socket vanishes | almost certainly an unserialisable value: route every send through `_send()`/`broadcast()` (`json_safe` is automatic there). The `last_error` in stats names it |
| 4401 on connect | token missing/expired — re-login; the frontend keeps the JWT in localStorage |
| 4403 on connect | expected — you need an active booking (or be the driver) |
| alert arrives twice (fix + alert frames) | by design — `fix` carries position, `alert` carries the verdict; fold them separately |

## 8. Commit message
```
feat(streaming): WebSocket push fan-out with HTTP-parity write path

- services/hub (registry + json_safe + never-raise broadcast)
- WS /stream/trips/{id} with 4401/4403 gates, heartbeat, error-frames
- record_ping shared by HTTP+WS; socket-first LiveTrack + admin push stats
- 6 new tests incl. real two-socket push flow
```

## 9. SRS / report notes
- Architecture figure for the report: ping → record_ping → store + auto-start
  + auto-check → hub.broadcast → watchers; heartbeat loop as the dotted backup
  arrow; HTTP ping entering the same box (proof of one write path).
- The `json_safe` incident is report gold: a raw datetime silently unsubscribed
  every watcher (failure mode), centralised normalisation fixed it, and the
  regression test pins it — examiners reward real debugging stories.
- Honest limitation: in-process hub (single uvicorn worker); stated scope in
  `stats()` + named Redis successor — no false claims about horizontal scale.
