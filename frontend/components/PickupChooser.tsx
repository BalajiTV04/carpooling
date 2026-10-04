"use client";
// Module 10 centrepiece: "Optimise my pickup point" inside a ride card.
// Shows the chosen meeting point (walk or door strategy), the saved detour,
// alternates to switch to, and the map with route + walk/detour connector.
import { useState } from "react";
import { RouteMap, type MapDash, type MapPin } from "@/components/RouteMap";
import { pickupApi, type PickupOptions, type PickupPoint, type TripRoute } from "@/lib/pickup";
import type { PlaceHit } from "@/lib/geo";

function Metric({ label, value, tone }: { label: string; value: string; tone: "volt" | "iris" }) {
  return (
    <div className="rounded-2xl bg-night-900 px-3 py-2 text-center">
      <p className={`font-display text-base font-bold ${tone === "volt" ? "text-volt-300" : "text-iris-300"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-[#A5ABD6]">{label}</p>
    </div>
  );
}

function PointRow({ p, active, onPick }: { p: PickupPoint; active: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className={`w-full rounded-2xl border px-3 py-2 text-left text-xs ${
        active ? "border-volt-400 bg-volt-400/10" : "border-[rgba(154,151,255,.25)] hover:border-volt-400/50"
      }`}
    >
      <span className="font-semibold text-[#EEF0FF]">
        {p.strategy === "walk" ? "🚶 Walk to route" : "🚗 Door pickup"}
      </span>
      <span className="text-[#A5ABD6]">
        {" "}· walk {Math.round(p.walk_km * 1000)} m ({p.walk_min} min) · detour {p.detour_km} km
      </span>
      {p.label && <span className="block truncate text-[11px] text-[#5b6194]">{p.label}</span>}
    </button>
  );
}
export function PickupChooser({ tripId, pickupHint, dropHint }: {
  tripId: string;
  pickupHint: PlaceHit | null;
  dropHint: PlaceHit | null;
}) {
  const [opts, setOpts] = useState<PickupOptions | null>(null);
  const [route, setRoute] = useState<TripRoute | null>(null);
  const [selected, setSelected] = useState<PickupPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (mode: "auto" | "walk" | "door" = "auto") => {
    if (!pickupHint || !dropHint) {
      setErr("Search a pickup point first (the From box) to optimise against.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const [o, r] = await Promise.all([
        pickupApi.options(tripId, {
          pickup_coordinates: [pickupHint.lng, pickupHint.lat],
          dropoff_coordinates: [dropHint.lng, dropHint.lat],
          mode, max_walk_km: 1.5
        }),
        route ? Promise.resolve(route) : pickupApi.route(tripId)
      ]);
      setOpts(o);
      setRoute(r);
      setSelected(o.chosen);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Optimisation failed");
    } finally {
      setBusy(false);
    }
  };

  const pins: MapPin[] = [];
  const dashes: MapDash[] = [];
  if (pickupHint) pins.push({ lng: pickupHint.lng, lat: pickupHint.lat, label: "Your location", color: "#F2545B" });
  if (selected) {
    pins.push({ lng: selected.coordinates[0], lat: selected.coordinates[1], label: "Meeting point", color: "#C6FF4A" });
    if (pickupHint) {
      dashes.push({
        from: [pickupHint.lng, pickupHint.lat],
        to: selected.coordinates,
        color: selected.strategy === "walk" ? "#C6FF4A" : "#F2545B"
      });
    }
  }
  const coords = route?.geometry?.coordinates;
  const first = coords && coords.length > 0 ? coords[0] : null;
  const last = coords && coords.length > 0 ? coords[coords.length - 1] : null;

  return (
    <div className="mt-3 rounded-2xl border border-[rgba(154,151,255,.3)] bg-night-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-[#EEF0FF]">Minimum-detour pickup</p>
        <div className="flex gap-1.5">
          <button
            onClick={() => run("auto")} disabled={busy}
            className="rounded-full bg-volt-400 px-3 py-1 text-[11px] font-bold text-night-950 disabled:opacity-60"
          >
            {busy ? "Optimising…" : opts ? "Re-run" : "Optimise point →"}
          </button>
          {opts && (
            <>
              <button onClick={() => run("walk")} className="rounded-full border border-volt-400/50 px-3 py-1 text-[11px] text-volt-300">
                Force walk
              </button>
              <button onClick={() => run("door")} className="rounded-full border border-iris-400/60 px-3 py-1 text-[11px] text-iris-300">
                Force door
              </button>
            </>
          )}
        </div>
      </div>

      {err && <p className="mt-2 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">{err}</p>}
      {opts && !opts.chosen && (
        <p className="mt-2 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">
          {opts.reason ?? "No usable pickup point on this route."}
        </p>
      )}

      {opts?.chosen && selected && (
        <>
          <p className="mt-2 rounded-2xl border border-[rgba(198,255,74,.35)] bg-night-900 p-2 text-[11px] text-volt-300">
            {selected.why}
            {opts.saved_detour_km > 0 && (
              <span className="text-[#A5ABD6]"> · saves {opts.saved_detour_km} km vs your exact door</span>
            )}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Metric label="your walk" value={`${Math.round(selected.walk_km * 1000)} m`} tone="volt" />
            <Metric label="driver detour" value={`${selected.detour_km} km`} tone="iris" />
            <Metric label="board at" value={`${selected.km_from_start.toFixed(1)} km`} tone="volt" />
          </div>
          {opts.alternates.length > 0 && (
            <div className="mt-2 grid gap-1.5">
              <p className="text-[10px] uppercase tracking-wider text-[#5b6194]">Alternatives</p>
              {opts.alternates.map((a, i) => (
                <PointRow
                  key={`${a.coordinates[0]},${a.coordinates[1]},${i}`}
                  p={a}
                  active={a.coordinates[0] === selected.coordinates[0] && a.strategy === selected.strategy}
                  onPick={() => setSelected(a)}
                />
              ))}
            </div>
          )}
          <div className="mt-2">
            <RouteMap
              src={route?.routed && first ? [first[0], first[1]] : null}
              dst={route?.routed && last ? [last[0], last[1]] : null}
              geometry={route?.routed ? route.geometry : null}
              pins={pins}
              dashes={dashes}
              height={240}
            />
            <p className="mt-1 text-center text-[10px] text-[#5b6194]">
              {opts.considered} candidates scanned every {opts.step_km} km · route {opts.route_km} km
              {route?.routed ? "" : " · route not detailed for this trip"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}