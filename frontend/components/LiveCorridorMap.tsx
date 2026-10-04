"use client";
// Public landing map: a REAL OSM map of the Bengaluru corridor. No login and
// no backend call, so the index page renders a live map even on a cold start.
import { useEffect, useRef } from "react";
import { RouteMap } from "@/components/RouteMap";

/** Hebbal -> Whitefield -> Electronic City: the project's demo corridor. */
const CORRIDOR: [number, number][] = [
  [77.5946, 13.0358], // Hebbal
  [77.6095, 12.9757], // MG Road
  [77.6206, 12.9698], // Indiranagar
  [77.7499, 12.9698], // Whitefield
  [77.6700, 12.8452] // Electronic City
];

export function LiveCorridorMap() {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="map-glow relative overflow-hidden rounded-xl3 border border-[rgba(154,151,255,.25)]">
      {/* Real tiles + the corridor line, drawn by the shared RouteMap. */}
      <RouteMap
        src={CORRIDOR[0]}
        dst={CORRIDOR[CORRIDOR.length - 1]}
        geometry={{ type: "LineString", coordinates: CORRIDOR }}
        height={420}
      />

      {/* Caption strip */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-2xl border border-volt-400/25 bg-night-950/85 px-3 py-2 text-[11px] backdrop-blur">
        <span className="font-bold text-volt-300">Live corridor</span>
        <span className="text-[#A5ABD6]">
          {" "}
          Hebbal → MG Road → Indiranagar → Whitefield → Electronic City
        </span>
      </div>
      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-volt-400/30 bg-night-950/80 px-3 py-1 text-[11px] font-semibold text-volt-300 backdrop-blur">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-volt-400 align-middle" />
        OpenStreetMap · live
      </div>
    </div>
  );
}