"use client";
// /trips (driver console, Module 7): map-centric publish — search From/To,
// live route preview on the map, then stage draft → publish.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { tripApi, type Trip } from "@/lib/trips";
import { vehicleApi, type Vehicle } from "@/lib/vehicles";
import { geoApi, type PlaceHit, type RoutePreview } from "@/lib/geo";
import { PlacePicker } from "@/components/PlacePicker";
import { RouteMap } from "@/components/RouteMap";
import { TripCard } from "@/components/TripCard";
import { Field, inputCls } from "@/components/AuthShell";
import { PageShell } from "@/components/PageShell";

export default function TripsPage() {
  return (
    <RequireAuth roles={["driver"]}>
      <TripsInner />
    </RequireAuth>
  );
}

function TripsInner() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [cars, setCars] = useState<Vehicle[]>([]);
  const [src, setSrc] = useState<PlaceHit | null>(null);
  const [dst, setDst] = useState<PlaceHit | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [seats, setSeats] = useState(2);
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [routing, setRouting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setTrips(await tripApi.mine());
    setCars(await vehicleApi.list());
  };
  useEffect(() => { load().catch((e: unknown) => setErr(e instanceof Error ? e.message : "Load failed")); }, []);

  // Live preview: debounce 600ms after both pins set (courtesy to OSRM demo).
  useEffect(() => {
    if (!src || !dst) {
      setPreview(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setRouting(true);
      try {
        setPreview(await geoApi.route([src.lng, src.lat], [dst.lng, dst.lat]));
      } catch {
        setPreview(null);
      } finally {
        setRouting(false);
      }
    }, 600);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [src, dst]);

  const verified = cars.filter((c) => c.verification_status === "verified" && c.is_active);
  const cap = cars.find((c) => c.id === vehicleId)?.seats_total ?? 7;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (!src || !dst) throw new Error("Search and pick both places");
      if (!vehicleId) throw new Error("Choose a verified car");
      const depart_at = new Date(`${date}T${time}:00`).toISOString();
      const t = await tripApi.create({
        vehicle_id: vehicleId,
        source: { name: src.name, coordinates: [src.lng, src.lat] },
        destination: { name: dst.name, coordinates: [dst.lng, dst.lat] },
        depart_at, seats_offered: seats
      });
      const tag = preview?.routed ? "routed" : "crow-flies (routing offline)";
      setMsg(`Draft staged — ${t.distance_km} km ${tag} ✓`);
      setSrc(null);
      setDst(null);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
  };

  return (
    <PageShell
      title="Driver console"
      accent="· trips"
      subtitle={
        <>
          No verified car? <Link href="/garage" className="text-volt-300">Add one in the garage →</Link>
        </>
      }
    >
      {msg && <p className="mt-3 rounded-2xl border border-volt-400/40 bg-volt-400/10 p-3 text-sm text-volt-300">{msg}</p>}
      {err && <p className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      <form onSubmit={submit} className="mt-4 grid gap-4 lg:grid-cols-[.95fr_1.05fr]">
        <div className="grid content-start gap-3 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
          <h2 className="font-display font-bold">Publish a trip</h2>
          <Field label="Car (verified only)">
            <select className={inputCls} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
              <option value="">— choose car —</option>
              {verified.map((c) => (
                <option key={c.id} value={c.id}>{c.make} {c.model} · {c.plate_no}</option>
              ))}
            </select>
          </Field>
          <PlacePicker label="From" value={src} onPick={setSrc} placeholder="Hebbal… try “Man miss”" />
          <PlacePicker label="To" value={dst} onPick={setDst} placeholder="Electronic City…" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Time">
              <input className={inputCls} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </Field>
            <Field label={`Seats ≤${cap}`}>
              <select className={inputCls} value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].slice(0, cap).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </div>
          <button disabled={busy || !src || !dst} className="rounded-2xl bg-volt-400 py-2.5 text-sm font-bold text-night-950 shadow-glow disabled:opacity-50">
            {busy ? "Staging…" : "Stage as draft →"}
          </button>
        </div>
        <div>
          <RouteMap
            src={src ? [src.lng, src.lat] : null}
            dst={dst ? [dst.lng, dst.lat] : null}
            geometry={preview?.geometry ?? null}
            height={380}
          />
          <p className="mt-2 text-center text-xs text-[#A5ABD6]">
            {!src || !dst
              ? "Search both places — the route draws itself here."
              : routing
                ? "Routing…"
                : preview
                  ? `${preview.routed ? "🛣 Routed" : "⚠ Crow-flies (offline)"} · ${preview.distance_km} km${preview.duration_min ? ` · ~${preview.duration_min} min` : ""}`
                  : "Preview unavailable."}
          </p>
        </div>
      </form>
      <h2 className="font-display mt-6 font-bold">My trips ({trips.length})</h2>
      <div className="mt-3 grid gap-3">
        {trips.length === 0 && (
          <div className="rounded-xl3 border border-dashed border-[rgba(154,151,255,.35)] p-8 text-center text-sm text-[#A5ABD6]">
            No trips yet — stage your first draft above.
          </div>
        )}
        {trips.map((t) => (
          <TripCard
            key={t.id} t={t}
            onPublish={() => act(() => tripApi.publish(t.id), "Published ✓ — passengers can find it in Module 8")}
            onCancel={() => act(() => tripApi.cancel(t.id), "Trip cancelled")}
            onDelete={() => act(() => tripApi.remove(t.id), "Trip deleted")}
            onChanged={load}
          />
        ))}
      </div>
    </PageShell>
  );
}
