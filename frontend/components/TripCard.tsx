// Driver trip card: route line, seats bar, lifecycle actions (M6 + M19),
// cost panel, live push view (M20) and the safety banner (M18).
"use client";
import { useEffect, useState } from "react";
import { statusCls, tripApi, type Trip, type TripSummary } from "@/lib/trips";
import { TripCostCard } from "@/components/TripCostCard";
import { LiveTrack } from "@/components/LiveTrack";
import { SafetyBanner } from "@/components/SafetyBanner";
import { RateRideCard } from "@/components/RateRideCard";
import { ratingApi, type PendingRating } from "@/lib/ratings";

/** Module 22 driver side: one review prompt per rider on this trip. */
function RateRiders({ tripId }: { tripId: string }) {
  const [rows, setRows] = useState<PendingRating[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    ratingApi.pending()
      .then((p) => {
        setRows(p.items.filter((i) => i.trip_id === tripId));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [tripId]);
  if (!loaded || rows.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2">
      <p className="text-[11px] text-[#5b6194]">
        Riders on this trip — leave a review (one per person, editable later).
      </p>
      {rows.map((r) => <RateRideCard key={r.booking_id} row={r} />)}
    </div>
  );
}

function Receipt({ s }: { s: TripSummary }) {
  return (
    <div className="mt-2 rounded-2xl border border-[rgba(198,255,74,.3)] bg-night-950 p-3 text-[11px]">
      <p className="font-bold text-volt-300">
        Trip receipt {s.completed ? "· completed" : `· ${s.status} (provisional)`}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[#A5ABD6] sm:grid-cols-4">
        <span>seats sold <b className="text-[#EEF0FF]">{s.seats_sold}/{s.seats_offered}</b></span>
        <span>occupancy <b className="text-[#EEF0FF]">{s.occupancy_pct}%</b></span>
        <span>collected <b className="text-volt-300">₹{s.collected_total}</b></span>
        <span>duration <b className="text-[#EEF0FF]">{s.duration_min ?? "—"} min</b></span>
      </div>
      {s.auto_rejected > 0 && (
        <p className="mt-1 text-[#A5ABD6]">
          {s.auto_rejected} unanswered request{s.auto_rejected > 1 ? "s" : ""} auto-rejected at completion.
        </p>
      )}
      {s.bookings.length > 0 && (
        <ul className="mt-1 grid gap-0.5">
          {s.bookings.map((b) => (
            <li key={b.booking_id} className="flex justify-between text-[#A5ABD6]">
              <span>passenger {b.passenger_id.slice(-6)} · {b.seats} seat{b.seats > 1 ? "s" : ""}</span>
              <span className="font-mono text-[#EEF0FF]">₹{b.cost_share}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-[#5b6194]">{s.note}</p>
    </div>
  );
}

export function TripCard({
  t, onPublish, onCancel, onDelete, onChanged
}: {
  t: Trip;
  onPublish: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onChanged?: () => void;
}) {
  const [costOpen, setCostOpen] = useState(false);
  const [receipt, setReceipt] = useState<TripSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pct = t.seats_offered === 0 ? 0 : Math.round((t.seats_booked / t.seats_offered) * 100);
  const when = new Date(t.depart_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const live = t.status === "published" || t.status === "ongoing";

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      onChanged?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display font-bold">{t.source_name} → {t.destination_name}</p>
          <p className="text-xs text-[#A5ABD6]">{when}{t.distance_km ? ` · ~${t.distance_km} km` : ""}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${statusCls(t.status)}`}>{t.status}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-night-950">
        <div className="h-full bg-gradient-to-r from-iris-500 to-volt-400" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-[#A5ABD6]">{t.seats_booked}/{t.seats_offered} seats filled · {t.seats_left} left</p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {t.status === "draft" && (
          <button onClick={onPublish} className="rounded-full bg-volt-400 px-3 py-1.5 font-bold text-night-950">Publish</button>
        )}
        {t.status === "published" && (
          <button
            disabled={busy}
            onClick={() => act(() => tripApi.start(t.id),
              "Trip started — share your location below.")}
            className="rounded-full bg-iris-500 px-3 py-1.5 font-bold text-white disabled:opacity-50"
          >
            Start trip
          </button>
        )}
        {live && (
          <button
            disabled={busy}
            onClick={() => act(async () => {
              const s = await tripApi.complete(t.id);
              setReceipt(s as TripSummary);
            }, "Trip completed ✓ — money is frozen, receipt below.")}
            className="rounded-full border border-volt-400/60 px-3 py-1.5 font-bold text-volt-300 disabled:opacity-50"
          >
            Complete ride
          </button>
        )}
        {(t.status === "draft" || t.status === "published") && (
          <button onClick={onCancel} className="rounded-full border border-rose-400/50 px-3 py-1.5 text-rose-300">Cancel</button>
        )}
        {(t.status === "draft" || t.status === "cancelled") && (
          <button onClick={onDelete} className="rounded-full border border-[rgba(154,151,255,.35)] px-3 py-1.5 text-[#A5ABD6]">Delete</button>
        )}
        <button
          onClick={() => setCostOpen(!costOpen)}
          className="rounded-full border border-volt-400/50 px-3 py-1.5 font-bold text-volt-300"
        >
          {costOpen ? "Hide cost" : "Cost ₹"}
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            if (receipt) { setReceipt(null); return; }
            setBusy(true);
            setErr(null);
            try {
              setReceipt(await tripApi.summary(t.id));
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Receipt unavailable");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-full border border-[rgba(154,151,255,.35)] px-3 py-1.5 text-[#A5ABD6] disabled:opacity-50"
        >
          {receipt ? "Hide receipt" : "Receipt"}
        </button>
      </div>
      {msg && <p className="mt-2 rounded-2xl border border-volt-400/40 bg-volt-400/10 p-2 text-[11px] text-volt-300">{msg}</p>}
      {err && <p className="mt-2 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">{err}</p>}
      {costOpen && <TripCostCard tripId={t.id} seatsLeft={t.seats_left} />}
      {receipt && <Receipt s={receipt} />}
      {/* Module 22: after the ride closes, the driver can review each rider. */}
      {(t.status === "completed" || receipt?.completed) && (
        <RateRiders tripId={t.id} />
      )}
      {live && (
        <>
          <LiveTrack
            tripId={t.id}
            canPing
            pingAt={[t.source.point.coordinates[0], t.source.point.coordinates[1]]}
          />
          <SafetyBanner tripId={t.id} isDriverForce />
        </>
      )}
    </div>
  );
}
