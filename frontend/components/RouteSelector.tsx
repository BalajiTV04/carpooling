"use client";
// Module 26: Route selector for booking a ride.
// Shows available route options between source & destination (distance, duration,
// route-quality badge) and lets the passenger pick one. The chosen route is
// stored on the booking and used for detour optimisation.
import { useState } from "react";
import { RouteMap } from "@/components/RouteMap";
import type { Trip } from "@/lib/trips";

type MapSize = "small" | "medium" | "large";

const SIZE_HEIGHT: Record<MapSize, number> = { small: 80, medium: 140, large: 200 };

function fmtKm(v: number | null | undefined) { return v == null ? "—" : v.toFixed(1) + " km"; }
function fmtMin(v: number | null | undefined) { return v == null ? "—" : v.toFixed(0) + " min"; }

export type RouteOption = {
  name: string;
  geometry: { type: string; coordinates: [number, number][] };
  distance_km?: number | null;
  duration_min?: number | null;
};

export function RouteSelector({
  trip,
  value,
  onChange,
}: {
  trip: Trip;
  value: RouteOption | null;
  onChange: (opt: RouteOption | null) => void;
}) {
  const [mapSize, setMapSize] = useState<MapSize>("small");
  const [mapsMinimized, setMapsMinimized] = useState(false);

  const routes: RouteOption[] = [];

  // Build the option list: primary route first, then alternatives.
  if (trip.route_geometry) {
    routes.push({
      name: "Fastest route",
      geometry: trip.route_geometry,
      distance_km: trip.distance_km ?? null,
      duration_min: trip.duration_min ?? null,
    });
  }
  (trip.route_alternatives ?? []).forEach((g, i) => {
    routes.push({
      name: `Route ${i + 2}`,
      geometry: g,
    });
  });

  if (routes.length === 0) return null;

  const active = routes.findIndex(
    (r) => value && JSON.stringify(r.geometry) === JSON.stringify(value.geometry)
  );
  const mapHeight = SIZE_HEIGHT[mapSize];

  return (
    <div className="mt-3 rounded-2xl border border-brand-teal/30 bg-surface p-3">
      {/* Header: route count + size toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-ink">Choose route</p>
          <span className="rounded-full border border-brand-teal/50 bg-brand-teal/10 px-2 py-0.5 text-[10px] font-bold text-brand-teal">
            {routes.length} option{routes.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted">
          <span className="font-semibold">Map size:</span>
          {(["small", "medium", "large"] as MapSize[]).map((sz) => (
            <button
              key={sz}
              onClick={() => setMapSize(sz)}
              className={`rounded-lg px-2 py-1 text-xs transition border ${
                mapSize === sz
                  ? "border-brand-teal bg-brand-teal/10 text-brand-teal font-bold"
                  : "border-brand-teal/26 text-muted hover:border-brand-teal/50"
              }`}
            >
              {sz === "small" ? "S" : sz === "medium" ? "M" : "L"}
            </button>
          ))}
          <button
            onClick={() => setMapsMinimized((p) => !p)}
            className={`rounded-lg px-2 py-1 text-xs transition border ${
              mapsMinimized
                ? "border-brand-teal bg-brand-teal/10 text-brand-teal font-bold"
                : "border-brand-teal/26 text-muted hover:border-brand-teal/50"
            }`}>
            {mapsMinimized ? "Show maps" : "Hide maps"}
          </button>
        </div>
      </div>

      {/* Quick comparison strip: all route distances at a glance */}
      <div className="flex flex-wrap gap-2 mb-3">
        {routes.map((r, i) => (
          <span
            key={i}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium transition ${
              i === active
                ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                : "border-brand-teal/30 bg-surface/50 text-ink"
            }`}
          >
            {r.name}{" "}
            <span className="text-muted/80">· {fmtKm(r.distance_km)}</span>
            {r.duration_min != null && <span className="text-muted/80">· {fmtMin(r.duration_min)}</span>}
          </span>
        ))}
      </div>
      <div className="grid gap-2">
        {routes.map((r, i) => {
          const isActive = i === active;
          const coords = r.geometry.coordinates;
          const first = coords[0];
          const last = coords[coords.length - 1];
          return (
            <button
              key={i}
              onClick={() => onChange(isActive ? null : r)}
              className={`w-full rounded-2xl border p-2.5 text-left transition ${
                isActive
                  ? "border-brand-teal bg-brand-teal/10 shadow-[0_0_0_1px_#14b8a6]"
                  : "border-brand-teal/26 hover:border-brand-teal/50"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 mt-0.5">
                  <span className={`rounded-full border px-1.5 py-0 text-[10px] font-bold ${
                    isActive ? "bg-brand-teal text-on-brand-teal border-brand-teal" : "border-brand-teal/30 text-muted"
                  }`}>
                    {i + 1}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-ink">{r.name}</span>
                    {isActive && (
                      <span className="rounded-full border border-brand-teal/50 bg-brand-teal/10 px-1.5 py-0 text-[10px] font-bold text-brand-teal">
                        SELECTED
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[10px] text-muted">
                    <span>{fmtKm(r.distance_km)}</span>
                    <span className="text-muted/60">·</span>
                    <span>{fmtMin(r.duration_min)}</span>
                    {i > 0 && (
                      <span className="text-muted/60">· alt</span>
                    )}
                  </div>
                </div>
              </div>
              {!mapsMinimized && (
                <div className="mt-2 rounded-xl border border-brand-teal/20 overflow-hidden">
                  <RouteMap
                    src={first ? [first[0], first[1]] : null}
                    dst={last ? [last[0], last[1]] : null}
                    geometry={{
                      type: "LineString",
                      coordinates: coords.map(([lng, lat]) => [lng, lat]),
                    }}
                    height={mapHeight}
                    routeColor={isActive ? "#14b8a6" : "#9ca3af"}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Clear instruction: route selection is separate from hosting */}
      <div className="mt-3 rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-2.5 text-xs">
        <div className="flex items-start gap-2">
          <span className="text-brand-teal font-bold">📋</span>
          <span className="text-ink">
            <span className="font-semibold">Select a route above</span>, then click{" "}
            <span className="font-semibold text-brand-teal">Host & Save Draft</span> below to save this trip as a draft.{" "}
            Clicking a route card only chooses it — it does not book or host yet.
          </span>
        </div>
      </div>
    </div>
  );
}
