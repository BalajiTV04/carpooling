"use client";
// Click-to-pin map for PlacePicker. Shares the Leaflet CDN loader with
// RouteMap so the assets are only fetched once per page.
import { useEffect, useRef } from "react";
import { ensureLeaflet } from "@/components/RouteMap";

const KARNATAKA_CENTER: [number, number] = [13.0, 76.6];

export function PickerMap({
  pin, label, onPick, height = 240
}: {
  pin: [number, number] | null; // [lng, lat]
  label: string;
  onPick: (lng: number, lat: number) => void;
  height?: number;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  // Keep the latest callback without re-creating the map on every render.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    let dead = false;

    ensureLeaflet()
      .then((L) => {
        if (dead || !divRef.current || mapRef.current) return;
        const map = L.map(divRef.current, {
          zoomControl: true,
          scrollWheelZoom: false, // a scrolling page must not zoom the map by accident
          tap: true
        });
        const start: [number, number] = pin
          ? [pin[1], pin[0]]
          : KARNATAKA_CENTER;
        map.setView(start, pin ? 13 : 7);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors"
        }).addTo(map);

        map.on("click", (e: any) => pickRef.current(e.latlng.lng, e.latlng.lat));
        mapRef.current = map;
        // The container animates in, so Leaflet needs a nudge for tile sizing.
        const t = setTimeout(() => {
          try { map.invalidateSize(); } catch { /* map already gone */ }
        }, 150);
        return () => clearTimeout(t);
      })
      .catch(() => { /* CDN blocked: the text search still works */ });

    return () => {
      dead = true;
      try { mapRef.current?.remove(); } catch { /* already removed */ }
      mapRef.current = null;
      markerRef.current = null;
    };
    // Created once; pin updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move / create the pin whenever the selection changes.
  useEffect(() => {
    const L = (typeof window !== "undefined" ? window.L : null) as any;
    const map = mapRef.current;
    if (!map || !L) return;

    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }
    if (!pin) return;

    const icon = L.divIcon({ className: "", html: `<div class="pin-pulse"></div>` });
    const m = L.marker([pin[1], pin[0]], { icon }).addTo(map).bindPopup(label);
    markerRef.current = m;
    map.setView([pin[1], pin[0]], Math.max(map.getZoom(), 13));
  }, [pin, label]);

  return (
    <div className="map-glow overflow-hidden rounded-2xl border border-[rgba(154,151,255,.25)]">
      <div ref={divRef} className="leaflet-night z-0" style={{ height }} />
    </div>
  );
}