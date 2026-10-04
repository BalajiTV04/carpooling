// Leaflet night map (CDN, client-only): OSM tiles + route polyline + markers.
// Supports extra pins (meeting point / passenger door) and dashed connectors
// (walk path, detour leg) — used by the Module 10 pickup chooser.
"use client";
import { useEffect, useRef } from "react";

export type MapPin = { lng: number; lat: number; label: string; color: string };
export type MapDash = { from: [number, number]; to: [number, number]; color: string };

declare global {
  interface Window { L?: any }
}

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

/** Shared with PickerMap so the CDN assets are fetched at most once per page. */
export function ensureLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.L) return Promise.resolve(window.L);
  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.L));
      return;
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error("Map library failed to load"));
    document.body.appendChild(s);
  });
}

export function RouteMap({
  src, dst, geometry, height = 320, pins = [], dashes = []
}: {
  src?: [number, number] | null;
  dst?: [number, number] | null;
  geometry?: { type: string; coordinates: [number, number][] } | null;
  height?: number;
  pins?: MapPin[];
  dashes?: MapDash[];
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  // Create map once.
  useEffect(() => {
    let dead = false;
    ensureLeaflet()
      .then((L) => {
        if (dead || !divRef.current || mapRef.current) return;
        const map = L.map(divRef.current, { zoomControl: true }).setView([12.97, 77.59], 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors"
        }).addTo(map);
        mapRef.current = map;
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  // Redraw layers when pins/geometry change.
  useEffect(() => {
    const map = mapRef.current;
    const L = typeof window !== "undefined" ? window.L : null;
    if (!map || !L) return;
    map.eachLayer((lyr: any) => {
      if (lyr.options?.pane === "markerPane" || lyr instanceof L.Polyline || lyr instanceof L.Marker)
        map.removeLayer(lyr);
    });
    // Re-add tiles (tileLayer is not Polyline/Marker so it survives; guard anyway).
    let hasTiles = false;
    map.eachLayer((lyr: any) => { if (lyr instanceof L.TileLayer) hasTiles = true; });
    if (!hasTiles) {
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    }
    const bounds: [number, number][] = [];
    const dot = (color: string) =>
      L.divIcon({ className: "", html: `<div style="width:14px;height:14px;border-radius:99px;background:${color};border:3px solid #070A1A;box-shadow:0 0 12px ${color}"></div>` });
    if (geometry && geometry.coordinates.length >= 2) {
      const latlngs = geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(latlngs, { color: "#7B77FF", weight: 5, opacity: 0.9 }).addTo(map);
      L.polyline(latlngs, { color: "#C6FF4A", weight: 2, dashArray: "8 8", opacity: 0.9 }).addTo(map);
      bounds.push(...latlngs);
    }
    if (src) {
      L.marker([src[1], src[0]], { icon: dot("#C6FF4A") }).addTo(map).bindPopup("Pickup");
      bounds.push([src[1], src[0]]);
    }
    if (dst) {
      L.marker([dst[1], dst[0]], { icon: dot("#7B77FF") }).addTo(map).bindPopup("Drop");
      bounds.push([dst[1], dst[0]]);
    }
    dashes.forEach((d) => {
      L.polyline([[d.from[1], d.from[0]], [d.to[1], d.to[0]]], {
        color: d.color, weight: 3, dashArray: "6 6", opacity: 0.95
      }).addTo(map);
      bounds.push([d.from[1], d.from[0]], [d.to[1], d.to[0]]);
    });
    pins.forEach((p) => {
      L.marker([p.lat, p.lng], { icon: dot(p.color) }).addTo(map).bindPopup(p.label);
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30] });
    // Dependencies are stringified: callers pass fresh arrays each render, and
    // raw array identity would redraw the layers on every parent re-render.
  }, [
    JSON.stringify(src), JSON.stringify(dst), JSON.stringify(geometry),
    JSON.stringify(pins), JSON.stringify(dashes)
  ]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try { mapRef.current?.remove(); } catch {}
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="map-glow overflow-hidden rounded-xl3 border border-[rgba(154,151,255,.22)]">
      <div ref={divRef} style={{ height }} className="leaflet-night z-0" />
      <style>{`.leaflet-night .leaflet-tile-pane{filter:saturate(.7) brightness(.85) hue-rotate(-15deg);}`}</style>
    </div>
  );
}
