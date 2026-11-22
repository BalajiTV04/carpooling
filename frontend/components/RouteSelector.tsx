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
  routes: propRoutes,
  value,
  onChange,
}: {
  trip?: Trip;
  routes?: RouteOption[];
  value: RouteOption | null;
  onChange: (opt: RouteOption | null) => void;
}) {
  const [mapSize, setMapSize] = useState<MapSize>("small");
  const [mapsMinimized, setMapsMinimized] = useState(false);

  let routes: RouteOption[] = propRoutes ? [...propRoutes] : [];

  if (!propRoutes && trip) {
    if (trip.route_geometry) {
      routes.push({
        name: "Fastest route (Primary)",
        geometry: trip.route_geometry,
        distance_km: trip.distance_km ?? null,
        duration_min: trip.duration_min ?? null,
      });
    }
    (trip.route_alternatives ?? []).forEach((g: any, i) => {
      const geom = g?.geometry || (g?.type === "LineString" ? g : null);
      if (geom) {
        routes.push({
          name: g?.name || `Alternative Route ${i + 2}`,
          geometry: geom,
          distance_km: g?.distance_km ?? null,
          duration_min: g?.duration_min ?? null,
        });
      }
    });
  }

  if (routes.length === 0) return null;

  const active = routes.findIndex(
    (r) =>
      value &&
      JSON.stringify(r.geometry?.coordinates) ===
        JSON.stringify(value.geometry?.coordinates)
  );
  const mapHeight = SIZE_HEIGHT[mapSize];

  return (
    <div className="mt-3 rounded-2xl border border-brand-teal/30 bg-surface p-3.5 shadow-sm">
      {/* Header: route count + size toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-ink">Choose Route Option</p>
          <span className="rounded-full border border-brand-teal/50 bg-brand-teal/10 px-2 py-0.5 text-[10px] font-bold text-brand-teal">
            {routes.length} option{routes.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted">
          <span className="font-semibold">Map size:</span>
          {(["small", "medium", "large"] as MapSize[]).map((sz) => (
            <button
              type="button"
              key={sz}
              onClick={(e) => {
                e.preventDefault();
                setMapSize(sz);
              }}
              className={`rounded-lg px-2 py-1 text-xs transition border ${
                mapSize === sz
                  ? "border-brand-teal bg-brand-teal/10 text-brand-teal font-bold"
                  : "border-line text-muted hover:border-brand-teal/50 hover:text-ink"
              }`}
            >
              {sz === "small" ? "S" : sz === "medium" ? "M" : "L"}
            </button>
          ))}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setMapsMinimized((p) => !p);
            }}
            className={`rounded-lg px-2 py-1 text-xs transition border ${
              mapsMinimized
                ? "border-brand-teal bg-brand-teal/10 text-brand-teal font-bold"
                : "border-line text-muted hover:border-brand-teal/50 hover:text-ink"
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
                ? "border-brand-teal bg-brand-teal/15 text-brand-teal font-bold ring-1 ring-brand-teal"
                : "border-line bg-card/60 text-ink"
            }`}
          >
            {r.name}{" "}
            <span className="text-muted/80">· {fmtKm(r.distance_km)}</span>
            {r.duration_min != null && <span className="text-muted/80">· {fmtMin(r.duration_min)}</span>}
          </span>
        ))}
      </div>
      <div className="grid gap-2.5">
        {routes.map((r, i) => {
          const isActive = i === active;
          const coords = r.geometry?.coordinates || [];
          const first = coords[0];
          const last = coords[coords.length - 1];
          return (
            <button
              type="button"
              key={i}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(isActive ? null : r);
              }}
              className={`w-full rounded-2xl border p-3 text-left transition cursor-pointer ${
                isActive
                  ? "border-brand-teal bg-brand-teal/15 ring-2 ring-brand-teal/40 shadow-sm"
                  : "border-line bg-card/40 hover:border-brand-teal/50 hover:bg-card/80"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className="flex-shrink-0 mt-0.5">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    isActive ? "bg-brand-teal text-white border-brand-teal" : "border-line text-muted bg-surface"
                  }`}>
                    {i + 1}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className={`font-bold text-xs ${isActive ? "text-brand-teal" : "text-ink"}`}>
                      {r.name}
                    </span>
                    {isActive ? (
                      <span className="rounded-full border border-brand-teal/50 bg-brand-teal/20 px-2 py-0.5 text-[10px] font-bold text-brand-teal flex items-center gap-1">
                        ✓ SELECTED
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted hover:text-ink">Tap to select</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className="font-semibold text-ink">{fmtKm(r.distance_km)}</span>
                    <span className="text-muted/60">·</span>
                    <span className="font-medium text-ink">{fmtMin(r.duration_min)}</span>
                    {i === 0 ? (
                      <span className="text-brand-teal font-semibold text-[10px] px-1.5 py-0.2 rounded bg-brand-teal/10">
                        Primary / Shortest
                      </span>
                    ) : (
                      <span className="text-brand-amber font-semibold text-[10px] px-1.5 py-0.2 rounded bg-brand-amber/10">
                        Alternative
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {!mapsMinimized && coords.length > 0 && (
                <div className="mt-2.5 rounded-xl border border-brand-teal/20 overflow-hidden">
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
            <span className="font-semibold">Select your preferred route option above</span>, then click the{" "}
            <span className="font-bold text-brand-teal">Host & Save Draft</span> button on the right side to save this trip.{" "}
            Selecting a route only chooses your path — it does not auto-host.
          </span>
        </div>
      </div>
    </div>
  );
}
