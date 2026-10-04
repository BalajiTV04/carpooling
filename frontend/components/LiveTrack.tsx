// Live trip view (Modules 17 + 20): driver position + trail on the night map.
// Transport is SOCKET-first (push, instant) with a 30s poll underneath as a
// correctness net; the badge tells the truth about which one feeds the UI.
"use client";
import { useEffect, useRef, useState } from "react";
import { RouteMap } from "@/components/RouteMap";
import { trackingApi, type LiveFix, type Trail } from "@/lib/tracking";
import { subscribeTrip, type StreamStatus } from "@/lib/live";

type Frame = Record<string, any>;

/** Fold a pushed frame into the LiveFix shape the rest of the UI understands. */
function applyFrame(prev: LiveFix | null, frame: Frame): LiveFix | null {
  if (frame.type === "hello" || frame.type === "state") {
    return {
      trip_id: frame.trip_id, trip_status: frame.trip_status,
      fix: frame.fix ?? null, progress: frame.progress ?? null,
      stale: !!frame.stale, message: frame.message,
    } as LiveFix;
  }
  if (frame.type === "fix") {
    return {
      trip_id: frame.trip_id, trip_status: frame.trip_status,
      fix: frame.fix ?? prev?.fix ?? null,
      progress: frame.progress ?? prev?.progress ?? null,
      stale: false,
    } as LiveFix;
  }
  return prev;
}


export function LiveTrack({ tripId, geometry, canPing = false, pingAt = null }: {
  tripId: string;
  geometry?: { type: string; coordinates: [number, number][] } | null;
  canPing?: boolean;
  pingAt?: [number, number] | null;
}) {
  const [live, setLive] = useState<LiveFix | null>(null);
  const [trail, setTrail] = useState<Trail | null>(null);
  const [transport, setTransport] = useState<StreamStatus>("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sendRef = useRef<((m: Record<string, unknown>) => boolean) | null>(null);

  // Push channel + polling safety net (30s). The poll only fills in when the
  // socket has not delivered yet, so push stays authoritative.
  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const [l, t] = await Promise.all([
          trackingApi.live(tripId), trackingApi.trail(tripId).catch(() => null)]);
        if (!dead) { setLive((prev) => prev ?? l); setTrail(t); setErr(null); }
      } catch (e: unknown) {
        if (!dead && !live) setErr(e instanceof Error ? e.message : "Live view unavailable");
      }
    };
    poll();
    const pollId = setInterval(poll, 30000);

    const stream = subscribeTrip(tripId, {
      onStatus: (s, why) => { if (!dead) { setTransport(s); setDetail(why ?? null); } },
      onFrame: (frame) => {
        if (dead) return;
        const f = frame as Frame;
        if (f.type === "hello" && typeof f.open_alerts === "number")
          setOpenAlerts(f.open_alerts);
        if (f.type === "alert") setOpenAlerts((n) => n + 1);
        if (f.type === "fix") {
          const fix = f.fix;
          if (fix) {
            setTrail((prev) => ({
              trip_id: tripId, trip_status: "ongoing",
              count: (prev?.count ?? 0) + 1,
              fixes: [fix, ...(prev?.fixes ?? [])].slice(0, 100),
            }));
          }
        }
        setLive((prev) => applyFrame(prev, f));
      },
    });
    sendRef.current = stream.send;
    return () => { dead = true; clearInterval(pollId); stream.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const ping = async () => {
    if (!pingAt) return;
    setBusy(true);
    setNote(null);
    // Prefer the socket (lower latency, ack inline); HTTP is the fallback so a
    // dead push channel never blocks the driver from sharing.
    const sent = sendRef.current?.({ type: "ping", lng: pingAt[0], lat: pingAt[1] });
    if (!sent) {
      try {
        await trackingApi.ping(tripId, pingAt[0], pingAt[1], null);
        setNote("Shared over HTTP ✓ (socket not connected)");
      } catch (e: unknown) {
        setNote(e instanceof Error ? e.message : "Share failed");
      }
    } else {
      setNote("Shared over live socket ✓");
    }
    setBusy(false);
  };

  if (err) return <p className="mt-2 text-xs text-rose-300">{err}</p>;
  if (!live) return <p className="mt-2 text-xs text-[#A5ABD6]">Loading live view…</p>;
  if (!live.fix) {
    return <p className="mt-2 rounded-2xl border border-dashed border-[rgba(154,151,255,.35)] p-3 text-xs text-[#A5ABD6]">Driver has not shared location yet — check back after departure.</p>;
  }
  const frac = live.progress?.frac ?? null;
  const trailLine = trail && trail.fixes.length >= 2
    ? { type: "LineString", coordinates: [...trail.fixes].reverse().map((f) => [f.lng, f.lat] as [number, number]) }
    : null;
  return (
    <div className="mt-2 rounded-2xl border border-[rgba(198,255,74,.3)] bg-night-950 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-volt-400" />
        <span className="font-bold text-volt-300">LIVE · {live.trip_status}</span>
        <span className={`rounded-full border px-1.5 py-0.5 ${transport === "live" ? "border-volt-400/50 text-volt-300" : "border-[rgba(154,151,255,.4)] text-[#A5ABD6]"}`}>
          {transport === "live" ? "push" : transport === "connecting" ? "connecting…" : "polling"}
        </span>
        {openAlerts > 0 && (
          <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-rose-200">
            {openAlerts} alert{openAlerts > 1 ? "s" : ""}
          </span>
        )}
        {live.stale && <span className="rounded-full border border-amber-400/50 px-1.5 py-0.5 text-amber-300">stale (&gt;5 min)</span>}
        {live.progress?.off_route && <span className="rounded-full border border-rose-400/50 px-1.5 py-0.5 text-rose-300">off-route</span>}
        <span className="ml-auto text-[#A5ABD6]">
          {frac !== null ? `${Math.round(frac * 100)}% · ${live.progress?.remaining_km} km left` : ""}
          {live.fix.speed_kmph !== null && live.fix.speed_kmph !== undefined ? ` · ${live.fix.speed_kmph} km/h` : ""}
        </span>
      </div>
      {frac !== null && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-night-900">
          <div className="h-full bg-gradient-to-r from-iris-500 to-volt-400" style={{ width: `${Math.round(frac * 100)}%` }} />
        </div>
      )}
      <div className="mt-2">
        <RouteMap
          geometry={(trailLine ?? geometry ?? null) as { type: string; coordinates: [number, number][] } | null}
          pins={[{ lng: live.fix.lng, lat: live.fix.lat, label: "Driver now", color: "#C6FF4A" }]}
          height={220}
        />
      </div>
      {canPing && pingAt && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={ping} disabled={busy}
            className="rounded-full border border-volt-400/50 px-3 py-1.5 text-xs font-bold text-volt-300 disabled:opacity-50"
          >
            {busy ? "Sharing…" : "📍 Share live location"}
          </button>
          {note && <span className="text-[11px] text-[#A5ABD6]">{note}</span>}
          {transport !== "live" && detail && (
            <span className="text-[11px] text-[#5b6194]">{detail}</span>
          )}
        </div>
      )}
    </div>
  );
}
