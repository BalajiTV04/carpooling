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
    <div className="rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display font-bold">{t.source_name} → {t.destination_name}</p>
          <p className="text-xs text-[#A5ABD6]">
            {when} · {t.seats_left}/{t.seats_offered} seats left
            {t.distance_km ? ` · ~${t.distance_km} km` : ""}
          </p>
          <p className="mt-1 text-xs">
            <span className="text-volt-300">▲ {t.src_km} km from your start</span>
            <span className="text-[#5b6194]"> · </span>
            <span className="text-iris-300">▼ {t.dst_km} km to your end</span>
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded-full border border-volt-400/50 px-3 py-1.5 text-xs font-bold text-volt-300"
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
          <p className="mt-2 text-center text-[10px] text-[#5b6194]">
            trip id <span className="font-mono">{t.id.slice(-6)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
