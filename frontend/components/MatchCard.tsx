// Why-this-ride breakdown: rule score + learned AI blend + factor bars.
// The explainable-AI centerpiece: every factor visible, routed vs estimated.
import type { MatchInfo } from "@/lib/search";

function Bar({ label, value, display }: { label: string; value: number; display: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-[#A5ABD6]">{label}</span>
        <span className="font-semibold text-[#EEF0FF]">{display}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-night-950">
        <div
          className="h-full rounded-full bg-gradient-to-r from-iris-500 to-volt-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function MatchCard({ m }: { m: MatchInfo }) {
  const shown = m.blended ?? m.score;
  const ring = `conic-gradient(#C6FF4A ${shown}%, #1A2154 ${shown}% 100%)`;
  return (
    <div className="mt-2 rounded-2xl border border-[rgba(198,255,74,.3)] bg-night-950 p-3">
      <div className="flex items-center gap-3">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
          style={{ background: ring }}
        >
          <div className="grid h-11 w-11 place-items-center rounded-full bg-night-950">
            <span className="font-display text-sm font-bold text-volt-300">{Math.round(shown)}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-volt-300">
            {m.routed ? "Why this ride" : "Why (estimated — offline route)"}
            {m.ai_model === "logreg" && m.ai_score != null && (
              <span className="ml-1 rounded-full border border-volt-400/40 px-1.5 py-0.5 text-[10px] font-bold text-volt-300">
                AI · {Math.round(m.ai_score)}
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-[#A5ABD6]">
            overlap {m.overlap_pct}% · pickup {m.pickup_km} km · drop {m.dropoff_km} km
          </p>
          {m.ai_score != null && m.blended != null && (
            <p className="truncate text-[10px] text-[#5b6194]">
              rule {Math.round(m.score)} + AI {Math.round(m.ai_score)} → {Math.round(m.blended)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 grid gap-1.5">
        <Bar label="Route overlap" value={m.overlap_pct} display={`${m.overlap_pct}%`} />
        <Bar label="Pickup closeness" value={Math.max(0, 100 - (m.pickup_km / 3) * 100)} display={`${m.pickup_km} km`} />
        <Bar label="Drop-off closeness" value={Math.max(0, 100 - (m.dropoff_km / 5) * 100)} display={`${m.dropoff_km} km`} />
      </div>
      {m.ai_contributions && (
        <details className="mt-2 text-[10px] text-[#5b6194]">
          <summary className="cursor-pointer text-[#A5ABD6]">What the AI weighed</summary>
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
