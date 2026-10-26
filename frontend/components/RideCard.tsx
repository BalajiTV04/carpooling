// Result card: match-score card + endpoint distances + detail drawer.
// Drawer = route map + passenger-side pickup optimisation (Module 10).
"use client";
import { useState } from "react";
import { RouteMap } from "@/components/RouteMap";
import { MatchCard } from "@/components/MatchCard";
import { PickupChooser } from "@/components/PickupChooser";
import { BookingPanel } from "@/components/BookingPanel";
import type { RideHit } from "@/lib/search";
import type { PlaceHit } from "@/lib/geo";

export function RideCard({ t, pickupHint = null, dropHint = null }: {
  t: RideHit;
  pickupHint?: PlaceHit | null;
  dropHint?: PlaceHit | null;
}) {
  const [open, setOpen] = useState(false);
  const when = new Date(t.depart_at).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  });
  return (
    <div className="panel panel-hover p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Route strip: origin dot → dashed road → destination dot. */}
          <div className="route-strip">
            <span className="dot dot-from" aria-hidden />
            <span className="truncate font-display text-sm font-bold">{t.source_name}</span>
            <span className="line" aria-hidden />
            <span className="dot dot-to" aria-hidden />
            <span className="truncate font-display text-sm font-bold">{t.destination_name}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="pill pill-quiet">{when}</span>
            <span className="pill pill-volt">{t.seats_left}/{t.seats_offered} seats left</span>
            {t.distance_km ? <span className="pill pill-quiet">~{t.distance_km} km</span> : null}
          </div>
          <p className="mt-2 text-xs">
            <span className="text-brand-teal">▲ {t.src_km} km from your start</span>
            <span className="text-muted"> · </span>
            <span className="text-accent">▼ {t.dst_km} km to your end</span>
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="btn btn-ghost btn-sm shrink-0"
        >
          {open ? "Hide" : "View"}
        </button>
      </div>
      {t.match && <MatchCard m={t.match} />}
      {open && (
        <div className="mt-3">
          <RouteMap
            src={[t.source.point.coordinates[0], t.source.point.coordinates[1]]}
            dst={[t.destination.point.coordinates[0], t.destination.point.coordinates[1]]}
            geometry={null}
            height={220}
          />
          <PickupChooser tripId={t.id} pickupHint={pickupHint} dropHint={dropHint} />
          <BookingPanel tripId={t.id} seatsLeft={t.seats_left} pickupHint={pickupHint} dropHint={dropHint} />
          <p className="mt-2 text-center text-[10px] text-muted">
            trip id <span className="font-mono">{t.id.slice(-6)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
