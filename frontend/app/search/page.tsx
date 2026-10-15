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
      eyebrow="Passenger"
      subtitle="Published trips only · same-day · seats checked."
    >
      <form onSubmit={submit} className="panel mt-5 grid gap-3 p-5">
        <p className="text-[11px] text-muted">
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
        <details className="panel-inset px-4 py-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted">Match tuning (defaults fit the city)</summary>
          <div className="grid grid-cols-2 gap-3 py-2">
            <Field label="Max pickup km">
              <input className={inputCls} value={maxPickup} onChange={(e) => setMaxPickup(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Min overlap %">
              <input className={inputCls} value={minOverlap} onChange={(e) => setMinOverlap(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
        </details>
        <button disabled={busy} className="btn btn-primary w-full py-3">
          {busy ? "Searching…" : "Search rides →"}
        </button>
        {err && <p className="alert alert-err">{err}</p>}
      </form>
      {hits !== null && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold">
              {hits.length === 0 ? "No rides that day" : `${hits.length} ride${hits.length > 1 ? "s" : ""} found`}
            </h2>
            {aiBadge && <span className="pill pill-iris">{aiBadge} · blended = ½ rule + ½ AI</span>}
          </div>
          <div className="mt-3 grid gap-3">
            {hits.length === 0 && (
              <div className="empty">
                Try a nearby date or fewer seats. Drivers publish in{" "}
                <Link href="/trips" className="link-volt">/trips</Link>.
              </div>
            )}
            {hits.map((t) => <RideCard key={t.id} t={t} pickupHint={src} dropHint={dst} />)}
          </div>
          {excluded.length > 0 && (
            <details className="panel mt-4 p-4 text-xs">
              <summary className="cursor-pointer text-muted">
                {excluded.length} ride{excluded.length > 1 ? "s" : ""} skipped — why?
              </summary>
              <ul className="mt-2 grid gap-1 text-muted">
                {excluded.map((x) => (
                  <li key={x.id}>
                    <span className="text-ink">{x.source_name} → {x.destination_name}</span>
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
