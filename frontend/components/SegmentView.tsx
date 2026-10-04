"use client";
// SegmentView (Module 13): leg-by-leg cost strip. Occupancy dots, leg km,
// per-occupant ₹ and who rides that leg — the "who pays what and why" view.
import { useCallback, useEffect, useState } from "react";
import { segmentApi, type SegmentSummary } from "@/lib/segments";
import { POLICY_BLURBS, type CostPolicy } from "@/lib/cost";

export function SegmentView({ tripId, canRebuild = false }: {
  tripId: string;
  canRebuild?: boolean;
}) {
  const [view, setView] = useState<SegmentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(
    () => segmentApi.summary(tripId).then(setView).catch(() => setView(null)),
    [tripId]
  );
  useEffect(() => { load(); }, [load]);

  const rebuild = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await segmentApi.rebuild(tripId);
      setMsg(`Rebuilt ${r.segments} leg${r.segments === 1 ? "" : "s"} — shares recalculated ✓`);
      await load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Rebuild failed");
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <p className="mt-2 text-[11px] text-[#5b6194]">Loading leg split…</p>;

  if (!view.segmented) {
    return (
      <div className="mt-2 rounded-2xl border border-[rgba(154,151,255,.28)] bg-night-900 p-3 text-[11px] text-[#A5ABD6]">
        Whole-trip split ({view.policy.mode.replace("_", " ")})
        {view.reason ? ` — ${view.reason}` : ""}
        <p className="mt-1 text-[#5b6194]">{POLICY_BLURBS[view.policy.mode as CostPolicy]}</p>
      </div>
    );
  }

  const riderIds = Object.keys(view.totals);

  return (
    <div className="mt-2 rounded-2xl border border-[rgba(154,151,255,.28)] bg-night-900 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-[#EEF0FF]">
          Per-leg split · {view.segments.length} legs · {view.route_km} km
        </p>
        {canRebuild && (
          <button onClick={rebuild} disabled={busy}
            className="rounded-full border border-volt-400/50 px-2.5 py-1 text-[10px] font-bold text-volt-300 disabled:opacity-60">
            {busy ? "Rebuilding…" : "Recalculate ↻"}
          </button>
        )}
      </div>

      <div className="mt-2 grid gap-1.5">
        {view.segments.map((s) => (
          <div key={s.seq} className="rounded-2xl bg-night-950 p-2">
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-[#EEF0FF]">
                <span className="font-mono text-[10px] text-[#5b6194]">{s.seq + 1}.</span>{" "}
                {s.from_label} → {s.to_label}
              </span>
              <span className="shrink-0 text-[#A5ABD6]">
                {s.distance_km} km · <span className="font-bold text-volt-300">₹{s.leg_cost}</span>
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {(s.occupant_names ?? []).length === 0 ? (
                <span className="text-[10px] text-[#5b6194]">empty leg — nobody aboard</span>
              ) : (
                (s.occupant_names ?? []).map((n, i) => (
                  <span key={`${n}-${i}`}
                    className="rounded-full bg-iris-500/25 px-2 py-0.5 text-[10px] text-iris-300">
                    ● {n}
                  </span>
                ))
              )}
              {s.cost_per_occupant > 0 && (
                <span className="ml-auto text-[10px] text-[#A5ABD6]">
                  ≈ ₹{s.cost_per_occupant}/occupant
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 grid gap-1 border-t border-[rgba(154,151,255,.2)] pt-2">
        {riderIds.length === 0 ? (
          <p className="text-[11px] text-[#5b6194]">
            No confirmed riders yet — legs price the moment someone confirms.
          </p>
        ) : (
          riderIds.map((bid) => (
            <div key={bid} className="flex items-center justify-between text-[11px]">
              <span className="font-mono text-[#5b6194]">{bid.slice(-6)}</span>
              <span className="font-display font-bold text-volt-300">₹{view.totals[bid]}</span>
            </div>
          ))
        )}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#A5ABD6]">collected vs trip cost</span>
          <span className="text-[#EEF0FF]">
            ₹{view.collected_total} / ₹{view.fuel.total_cost}
          </span>
        </div>
        {view.fallback_riders && view.fallback_riders.length > 0 && (
          <p className="text-[10px] text-rose-300">
            {view.fallback_riders.length} rider(s) priced whole-trip (their drop-off projects upstream)
          </p>
        )}
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-volt-300">{msg}</p>}
    </div>
  );
}