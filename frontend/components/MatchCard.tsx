"use client";
// Why-this-ride breakdown: rule score + learned AI blend + factor bars + detour optimization.
// The explainable-AI centerpiece: every factor visible, routed vs estimated.
import type { MatchInfo, RideHit } from "@/lib/search";

function Bar({ label, value, display }: { label: string; value: number; display: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="font-semibold text-ink">{display}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-brand-teal"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function MatchCard({ m, hit }: { m: MatchInfo; hit?: RideHit }) {
  const shown = m.blended ?? m.score;
  const ring = `conic-gradient(#C6FF4A ${shown}%, #1A2154 ${shown}% 100%)`;

  const detourKm = m.detour_km ?? hit?.detour_km ?? 0;
  const passengerDist = m.passenger_distance_km ?? hit?.passenger_distance_km;
  const walkKm = m.pickup?.walk_km ?? m.pickup_km;
  const contrib = hit?.estimated_contribution;
  const isStraightLine = m.route_quality === "straight_line" || !m.routed;

  return (
    <div className="mt-2 rounded-2xl border border-brand-teal/30 bg-surface p-3">
      {/* Route quality warning if straight-line fallback */}
      {isStraightLine && (
        <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300">
          ⚠️ Straight-line fallback: OSRM route was temporarily unavailable. Tolerances are wider and estimates are approximate.
        </div>
      )}

      <div className="flex items-center gap-3">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
          style={{ background: ring }}
        >
          <div className="grid h-11 w-11 place-items-center rounded-full bg-surface">
            <span className="font-display text-sm font-bold text-brand-teal">{Math.round(shown)}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-bold text-brand-teal">
              {m.routed ? "Why this ride" : "Why (estimated — offline route)"}
              {m.ai_model === "logreg" && m.ai_score != null && (
                <span className="ml-1 rounded-full border border-brand-teal/40 px-1.5 py-0.5 text-[10px] font-bold text-brand-teal">
                  AI · {Math.round(m.ai_score)}
                </span>
              )}
            </p>
            {/* Detour badge */}
            {detourKm <= 0.05 ? (
              <span className="rounded-full bg-brand-teal/20 px-2 py-0.5 text-[10px] font-bold text-brand-teal">
                On route · 0 km detour
              </span>
            ) : (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent">
                Detour +{detourKm.toFixed(1)} km
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-muted">
            overlap {m.overlap_pct}% · pickup {m.pickup_km} km · drop {m.dropoff_km} km
          </p>
          {m.ai_score != null && m.blended != null && (
            <p className="truncate text-[10px] text-muted">
              rule {Math.round(m.score)} + AI {Math.round(m.ai_score)} → {Math.round(m.blended)}
            </p>
          )}
        </div>
      </div>

      {/* Minimum-detour pickup details strip */}
      <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-xl bg-surface-raised/40 p-2 text-[11px]">
        <div>
          <span className="text-muted block">Pickup Point</span>
          <span className="font-semibold text-ink truncate block">
            {m.pickup?.label || "Meeting point on route"}
          </span>
          <span className="text-[10px] text-brand-teal">
            Walk {Math.round(walkKm * 1000)} m
          </span>
        </div>
        <div>
          <span className="text-muted block">Drop Point</span>
          <span className="font-semibold text-ink truncate block">
            {m.drop?.label || "Drop on route"}
          </span>
          {passengerDist != null && (
            <span className="text-[10px] text-ink block">
              Passenger ride: {passengerDist} km
            </span>
          )}
        </div>
      </div>

      {contrib != null && (
        <div className="mt-2 flex items-center justify-between rounded-xl bg-brand-teal/10 px-2.5 py-1.5 text-xs">
          <span className="text-muted">Estimated Travel Contribution</span>
          <span className="font-bold text-brand-teal">₹{contrib}</span>
        </div>
      )}

      <div className="mt-2 grid gap-1.5">
        <Bar label="Route overlap" value={m.overlap_pct} display={`${m.overlap_pct}%`} />
        <Bar label="Pickup closeness" value={Math.max(0, 100 - (m.pickup_km / 3) * 100)} display={`${m.pickup_km} km`} />
        <Bar label="Drop-off closeness" value={Math.max(0, 100 - (m.dropoff_km / 5) * 100)} display={`${m.dropoff_km} km`} />
      </div>

      {m.ai_contributions && (
        <details className="mt-2 text-[10px] text-muted">
          <summary className="cursor-pointer text-muted">What the AI weighed</summary>
          <ul className="mt-1 grid gap-0.5">
            {(Object.entries(m.ai_contributions) as [string, number][]).map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span>{k.replace("01", " fit")}</span>
                <span className="font-mono">+{v.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
