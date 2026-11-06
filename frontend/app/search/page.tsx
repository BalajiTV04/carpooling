"use client";
// /search (Module 9 ranking + Module 10 pickup optimisation).
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { RequireAuth } from "@/components/RequireAuth";
import { searchApi, type Excluded, type RideHit } from "@/lib/search";
import type { PlaceHit } from "@/lib/geo";
import { PlacePicker } from "@/components/PlacePicker";
import { Field, inputCls } from "@/components/AuthShell";
import { RideCard } from "@/components/RideCard";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Car } from "lucide-react";

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
      {/* Search form — glass panel */}
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 glass-card p-6 grid gap-5"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Type a place — typos are fine — or tap 📍 to drop a pin on the map.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <PlacePicker label="From" value={src} onPick={setSrc} placeholder="Hebbal… try “Man miss”" />
          <PlacePicker label="To" value={dst} onPick={setDst} placeholder="Electronic City…" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
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
        <details className="panel-inset p-4 text-sm">
          <summary className="cursor-pointer flex items-center gap-2 text-xs text-muted">
            <span>🔧</span> Match tuning (defaults fit the city)
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Max pickup km">
              <input className={inputCls} value={maxPickup} onChange={(e) => setMaxPickup(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Min overlap %">
              <input className={inputCls} value={minOverlap} onChange={(e) => setMinOverlap(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
        </details>
        <Button variant="primary" size="lg" disabled={busy} className="w-full">
          {busy ? "Searching…" : "Search rides →"}
        </Button>
        {err && <Alert variant="danger">{err}</Alert>}
      </motion.form>
      {/* Results */}
      {hits !== null && (
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">
                {hits.length === 0 ? "No rides that day" : `${hits.length} ride${hits.length > 1 ? "s" : ""} found`}
              </h2>
            </div>
            {aiBadge && (
              <Badge variant="brand" className="text-[10px]">
                {aiBadge} · blended = ½ rule + ½ AI
              </Badge>
            )}
          </div>
          <div className="mt-5 grid gap-4">
            {hits.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="empty-state"
              >
                <div className="empty-icon">
                  <Car className="h-6 w-6 text-muted" />
                </div>
                <p className="text-sm text-muted">
                  Try a nearby date or fewer seats. Drivers publish in{" "}
                  <Link href="/trips" className="link-volt">/trips</Link>.
                </p>
              </motion.div>
            )}
            {hits.map((t, i) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ y: -2 }}
                className="glass-card p-5"
              >
                <RideCard key={t.id} t={t} pickupHint={src} dropHint={dst} />
              </motion.div>
            ))}
          </div>
          {excluded.length > 0 && (
            <details className="mt-6 panel-inset p-4 text-xs">
              <summary className="cursor-pointer flex items-center gap-2 text-xs text-muted">
                <span>🔍</span> {excluded.length} ride{excluded.length > 1 ? "s" : ""} skipped — why?
              </summary>
              <ul className="mt-3 grid gap-2 text-muted">
                {excluded.map((x) => (
                  <li key={x.id} className="flex justify-between">
                    <span className="text-ink">{x.source_name} → {x.destination_name}</span>
                    <span className="text-muted/80">{x.reason}</span>
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
