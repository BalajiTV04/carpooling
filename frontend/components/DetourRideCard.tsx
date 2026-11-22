// Detour-optimised ride result card.
// Shows pickup/drop points, passenger distance, driver detour, extra time,
// estimated contribution, seats left + a map with driver route + passenger segment.
// "use client" required: uses hooks + browser APIs (map).
"use client";
import { useState } from "react";
import { RouteMap } from "@/components/RouteMap";
import { Badge } from "@/components/ui/Badge";
import type { DetourRideResult } from "@/lib/search";

function fmtKm(v: number) { return v.toFixed(1) + " km"; }
function fmtMin(v: number) { return v.toFixed(0) + " min"; }
function fmtMoney(v: number) { return "₹" + Math.round(v).toLocaleString(); }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function DetourRideCard({ t }: { t: DetourRideResult }) {
  const [open, setOpen] = useState(false);
  const onRoute = t.detour_km === 0;
  const detourBadge = onRoute
    ? "On route · 0 km detour"
    : `Detour +${t.detour_km.toFixed(1)} km`;
  const when = fmtTime(t.departure_time);

  return (
    <div className="panel panel-hover p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {t.selected_route && (
            <div className="mt-1 mb-1 rounded-2xl border border-brand-teal/30 bg-surface p-2 text-[11px]">
              <span className="font-semibold text-ink">Route chosen:</span>{" "}
              <span className="text-brand-teal">{t.selected_route.name}</span>
              {t.selected_route.distance_km != null && (
                <span className="text-muted"> · {t.selected_route.distance_km.toFixed(1)} km</span>
              )}
            </div>
          )}
          <div className="route-strip">
            <span className="dot dot-from" aria-hidden />
            <span className="truncate font-display text-sm font-bold">
              {t.pickup_point.address || "Pickup point"}
            </span>
            <span className="line" aria-hidden />
            <span className="dot dot-to" aria-hidden />
            <span className="truncate font-display text-sm font-bold">
              {t.drop_point.address || "Drop point"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="pill pill-quiet">{when}</span>
            <span className="pill pill-volt">
              {t.seats_available} seat{t.seats_available === 1 ? "" : "s"} left
            </span>
            <span className="pill pill-quiet">
              {fmtKm(t.passenger_distance_km)} shared
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge
              variant={onRoute ? "success" : "warning"}
              className={`text-[10px] ${onRoute ? "text-success" : "text-ink"}`}
            >
              {detourBadge}
            </Badge>
            <Badge variant="muted" className="text-[10px]">
              +{fmtMin(t.extra_time_min)} for driver
            </Badge>
            {t.walk_distance_km > 0 && (
              <span className="pill pill-muted">
                walk {fmtKm(t.walk_distance_km)}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs">
            <span className="text-brand-teal">▲ {fmtKm(t.walk_distance_km)} to pickup</span>
            <span className="text-muted"> · </span>
            <span className="text-ink">
              Est. contribution {fmtMoney(t.estimated_contribution)}
              {t.estimated && <span className="text-muted/70"> (estimated)</span>}
            </span>
          </p>
          <p className="mt-1 text-[10px] text-muted">
            {t.seats_available} seat{t.seats_available === 1 ? "" : "s"} left · shared ride. Amount can change if others join or cancel. Final amount is settled when the trip ends.
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="btn btn-ghost btn-sm shrink-0"
        >
          {open ? "Hide" : "View"}
        </button>
      </div>
      {open && (
        <div className="mt-3 grid gap-3">
          <RouteMap
            src={null}
            dst={null}
            geometry={t.selected_route ? {
              type: "LineString",
              coordinates: t.selected_route.geometry.coordinates,
            } : {
              type: "LineString",
              coordinates: t.driver_route_polyline.map(([lat, lng]) => [lng, lat]),
            }}
            height={240}
            routeColor={t.selected_route ? "#14b8a6" : undefined}
            passengerSegment={
              t.passenger_segment_polyline.length >= 2
                ? t.passenger_segment_polyline
                : null
            }
            pins={[
              {
                lng: t.pickup_point.lng,
                lat: t.pickup_point.lat,
                label: "Pickup",
                color: "#C6FF4A",
              },
              {
                lng: t.drop_point.lng,
                lat: t.drop_point.lat,
                label: "Drop",
                color: "#7B77FF",
              },
            ]}
          />
          <div className="grid grid-cols-2 gap-2 text-xs text-muted">
            <div>
              <div className="text-ink/60">Passenger distance</div>
              <div className="font-mono text-ink">{fmtKm(t.passenger_distance_km)}</div>
            </div>
            <div>
              <div className="text-ink/60">Driver detour</div>
              <div className="font-mono text-ink">
                {onRoute ? "0 km" : "+" + fmtKm(t.detour_km)}
              </div>
            </div>
            <div>
              <div className="text-ink/60">Extra time</div>
              <div className="font-mono text-ink">{fmtMin(t.extra_time_min)}</div>
            </div>
            <div>
              <div className="text-ink/60">Route overlap</div>
              <div className="font-mono text-ink">{t.route_overlap_percent}%</div>
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] text-muted">
            trip id <span className="font-mono">{t.trip_id.slice(-6)}</span>{" "}
            {t.estimated ? "· routing estimated (haversine fallback)" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
