"use client";
// /search (Module 9 ranking + Module 10 pickup optimisation).
import { useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { searchApi, type Excluded, type RideHit } from "@/lib/search";
import type { PlaceHit } from "@/lib/geo";
import { PlacePicker } from "@/components/PlacePicker";
import { Field, inputCls } from "@/components/AuthShell";
import { RideCard } from "@/components/RideCard";
import { PageShell } from "@/components/PageShell";

export default function SearchPage() {
  return (
    <RequireAuth roles={["passenger"]}>
      <SearchInner />
    </RequireAuth>
  );
}

function SearchInner() {
  const [src, setSrc] = useState<PlaceHit | null>(null);
  const [dst, setDst] = useState<PlaceHit | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [seats, setSeats] = useState(1);
  const [hits, setHits] = useState<RideHit[] | null>(null);
  const [excluded, setExcluded] = useState<Excluded[]>([]);
  const [aiBadge, setAiBadge] = useState<string | null>(null);
  const [maxPickup, setMaxPickup] = useState("3");
  const [minOverlap, setMinOverlap] = useState("20");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (!src || !dst) throw new Error("Search and pick both places");
      if (!date) throw new Error("Pick a travel date");
      const r = await searchApi.rides({
        src_coordinates: [src.lng, src.lat],
        dst_coordinates: [dst.lng, dst.lat],
        date, time: time || undefined, seats,
        max_pickup_km: Number(maxPickup) || 3,
        min_overlap_pct: Number(minOverlap) || 0,
        include_excluded: true
      });
      setHits(r.results);
      setExcluded(r.excluded ?? []);
      const auc = r.ai?.auc?.logreg;
      setAiBadge(r.ai ? `${r.ai.model === "logreg" ? `AI ranked · logreg AUC ${auc?.toFixed(2)}` : "Rule ranked (AI artifact missing)"}` : null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Find a ride"
      subtitle="Published trips only · same-day · seats checked."
    >
      <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
        <p className="text-[11px] text-[#A5ABD6]">
          Type a place — typos are fine — or tap{" "}
          <span className="text-volt-300">📍</span> to drop a pin on the map.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <PlacePicker label="From" value={src} onPick={setSrc} placeholder="Hebbal… try “Man miss”" />
          <PlacePicker label="To" value={dst} onPick={setDst} placeholder="Electronic City…" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Time (±2h)">
            <input className={inputCls} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Seats">
            <select className={inputCls} value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <details className="rounded-2xl bg-night-950 px-4 py-2 text-sm">
          <summary className="cursor-pointer text-xs text-[#A5ABD6]">Match tuning (defaults fit the city)</summary>
          <div className="grid grid-cols-2 gap-3 py-2">
            <Field label="Max pickup km">
              <input className={inputCls} value={maxPickup} onChange={(e) => setMaxPickup(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Min overlap %">
              <input className={inputCls} value={minOverlap} onChange={(e) => setMinOverlap(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
        </details>
        <button disabled={busy} className="rounded-2xl bg-volt-400 py-2.5 text-sm font-bold text-night-950 shadow-glow disabled:opacity-60">
          {busy ? "Searching…" : "Search rides →"}
        </button>
        {err && <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      </form>
      {hits !== null && (
        <section className="mt-6">
          <h2 className="font-display font-bold">
            {hits.length === 0 ? "No rides that day" : `${hits.length} ride${hits.length > 1 ? "s" : ""} found`}
          </h2>
          {aiBadge && <p className="mt-1 text-[11px] text-volt-300">{aiBadge} · blended = ½ rule + ½ AI</p>}
          <div className="mt-3 grid gap-3">
            {hits.length === 0 && (
              <div className="rounded-xl3 border border-dashed border-[rgba(154,151,255,.35)] p-8 text-center text-sm text-[#A5ABD6]">
                Try a nearby date or fewer seats. Drivers publish in{" "}
                <Link href="/trips" className="text-volt-300">/trips</Link>.
              </div>
            )}
            {hits.map((t) => <RideCard key={t.id} t={t} pickupHint={src} dropHint={dst} />)}
          </div>
          {excluded.length > 0 && (
            <details className="mt-4 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/60 p-4 text-xs">
              <summary className="cursor-pointer text-[#A5ABD6]">
                {excluded.length} ride{excluded.length > 1 ? "s" : ""} skipped — why?
              </summary>
              <ul className="mt-2 grid gap-1 text-[#A5ABD6]">
                {excluded.map((x) => (
                  <li key={x.id}>
                    <span className="text-[#EEF0FF]">{x.source_name} → {x.destination_name}</span>
                    {" — "}{x.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </PageShell>
  );
}
