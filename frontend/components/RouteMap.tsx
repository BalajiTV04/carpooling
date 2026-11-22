// Leaflet night map (CDN, client-only): OSM tiles + route polyline + markers.
// Supports extra pins (meeting point / passenger door) and dashed connectors
// (walk path, detour leg) — used by the Module 10 pickup chooser.
"use client";
import { useEffect, useRef, useState } from "react";

export type MapPin = {
  lng: number;
  lat: number;
  label: string;
  color: string;
  iconType?: "car" | "dot" | "pickup" | "dropoff";
  heading?: number | null;
  speed_kmph?: number | null;
  plateNo?: string;
  driverName?: string;
  isSelected?: boolean;
};
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

function createCarIcon(pin: MapPin, L: any) {
  const color = pin.color || "#14b8a6";
  const heading = typeof pin.heading === "number" ? pin.heading : 0;
  const plate = pin.plateNo || "";
  const speed =
    pin.speed_kmph != null && pin.speed_kmph > 0
      ? `${Math.round(pin.speed_kmph)} km/h`
      : null;
  const isSelected = !!pin.isSelected;

  const html = `
    <div class="volt-car-marker" style="
      position: relative;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    ">
      <!-- Radar pulse effect for live vehicle -->
      <div style="
        position: absolute;
        inset: -2px;
        border-radius: 9999px;
        background: ${color}26;
        border: 1.5px solid ${color}55;
        animation: voltPulse 2.2s cubic-bezier(0, 0, 0.2, 1) infinite;
        pointer-events: none;
      "></div>

      <!-- Glowing backdrop disc -->
      <div style="
        position: absolute;
        width: 38px;
        height: 38px;
        border-radius: 9999px;
        background: rgba(7, 10, 26, 0.9);
        box-shadow: 0 0 ${isSelected ? "16px" : "10px"} ${color}88, inset 0 0 6px ${color}55;
        border: ${isSelected ? "2px" : "1.5px"} solid ${color};
        pointer-events: none;
      "></div>

      <!-- Rotatable Top-Down Car Body -->
      <div style="
        position: relative;
        z-index: 2;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(${heading}deg);
        transition: transform 0.4s ease-out;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
      ">
        <svg width="32" height="32" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- 4 Tires -->
          <rect x="7" y="7" width="3.5" height="7" rx="1.5" fill="#0f172a"/>
          <rect x="27.5" y="7" width="3.5" height="7" rx="1.5" fill="#0f172a"/>
          <rect x="7" y="24" width="3.5" height="7" rx="1.5" fill="#0f172a"/>
          <rect x="27.5" y="24" width="3.5" height="7" rx="1.5" fill="#0f172a"/>
          
          <!-- Outer Chassis -->
          <path d="M11 9C11 5 14.5 3 19 3C23.5 3 27 5 27 9V29C27 33 23.5 35 19 35C14.5 35 11 33 11 29V9Z" 
                fill="#070A1A" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
                
          <!-- Front Headlights (bright luminous yellow) -->
          <circle cx="13" cy="5" r="1.5" fill="#fef08a"/>
          <circle cx="25" cy="5" r="1.5" fill="#fef08a"/>
          
          <!-- Front Windshield -->
          <path d="M13 12C14.5 10 23.5 10 25 12L24 16H14L13 12Z" fill="#38bdf8" fill-opacity="0.9"/>
          
          <!-- Roof Cabin -->
          <rect x="14" y="16.5" width="10" height="7.5" rx="1" fill="#1e293b"/>
          
          <!-- Directional Arrow / Chevron pointing forward -->
          <path d="M19 18L16.5 21H21.5L19 18Z" fill="${color}"/>
          
          <!-- Rear Windshield -->
          <path d="M14 24.5H24L23 27.5C22 28.5 16 28.5 15 27.5L14 24.5Z" fill="#38bdf8" fill-opacity="0.75"/>
          
          <!-- Rear Taillights (ruby red) -->
          <rect x="12.5" y="34" width="3" height="1.2" rx="0.6" fill="#ef4444"/>
          <rect x="22.5" y="34" width="3" height="1.2" rx="0.6" fill="#ef4444"/>
        </svg>
      </div>

      <!-- Plate/Speed Badge below car -->
      ${
        plate || speed
          ? `
        <div style="
          position: absolute;
          bottom: -11px;
          left: 50%;
          transform: translateX(-50%);
          background: #070A1A;
          color: #f8fafc;
          border: 1px solid ${color};
          border-radius: 9999px;
          padding: 1px 6px;
          font-size: 9px;
          font-family: monospace;
          font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0,0,0,0.7);
          pointer-events: none;
          z-index: 3;
          display: flex;
          align-items: center;
          gap: 3px;
        ">
          ${plate ? `<span>${plate}</span>` : ""}
          ${speed ? `<span style="color:${color};">· ${speed}</span>` : ""}
        </div>
      `
          : ""
      }
    </div>
  `;

  return L.divIcon({
    className: "volt-car-divicon",
    html,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -24],
  });
}

function createCarPopup(pin: MapPin) {
  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 180px; padding: 2px;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: 800; font-size: 13px; color: #0f172a;">🚗 ${pin.plateNo || "Active Vehicle"}</span>
        ${pin.speed_kmph != null ? `<span style="background: #e0f2fe; color: #0284c7; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 99px;">${Math.round(pin.speed_kmph)} km/h</span>` : ""}
      </div>
      <div style="font-size: 11px; color: #475569; margin-bottom: 4px;">
        ${pin.driverName ? `<div>Driver: <strong>${pin.driverName}</strong></div>` : ""}
        <div>${pin.label}</div>
      </div>
      <div style="font-size: 10px; color: #94a3b8; font-family: monospace; border-top: 1px dashed #cbd5e1; padding-top: 4px; margin-top: 4px;">
        GPS: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)} ${pin.heading != null ? `· ${Math.round(pin.heading)}°` : ""}
      </div>
    </div>
  `;
}

function createPointIcon(symbol: string, color: string, L: any) {
  return L.divIcon({
    className: "volt-point-divicon",
    html: `
      <div style="
        position: relative;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #070A1A;
        border: 2px solid ${color};
        border-radius: 9999px;
        box-shadow: 0 0 10px ${color}88;
        font-size: 11px;
        font-weight: 800;
        color: ${color};
        font-family: system-ui, sans-serif;
      ">${symbol}</div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

export function RouteMap({
  src, dst, geometry, height = 320, pins = [], dashes = [],
  passengerSegment, routeColor = "#7B77FF"
}: {
  src?: [number, number] | null;     // [lng, lat]
  dst?: [number, number] | null;     // [lng, lat]
  geometry?: { type: string; coordinates: [number, number][] } | null; // [lng, lat]
  height?: number;
  pins?: MapPin[];
  dashes?: MapDash[];
  // Colour of the main route polyline.
  routeColor?: string;
  // Passenger's shared segment (pickup -> drop) in [lat, lng], drawn highlighted.
  passengerSegment?: [number, number][] | null;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

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
        setMapReady(true);
        setTimeout(() => {
          try { map.invalidateSize(); } catch {}
        }, 150);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  // Redraw layers when pins/geometry change.
  useEffect(() => {
    const map = mapRef.current;
    const L = typeof window !== "undefined" ? window.L : null;
    if (!map || !L || !mapReady) return;
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
      L.polyline(latlngs, { color: routeColor, weight: 5, opacity: 0.9 }).addTo(map);
      L.polyline(latlngs, { color: "#C6FF4A", weight: 2, dashArray: "8 8", opacity: 0.9 }).addTo(map);
      bounds.push(...latlngs);
    }
    // Passenger's shared segment (pickup -> drop) highlighted in amber.
    if (passengerSegment && passengerSegment.length >= 2) {
      const seg = passengerSegment.map(([lat, lng]) => [lat, lng] as [number, number]);
      L.polyline(seg, { color: "#fbbf24", weight: 6, opacity: 0.95 }).addTo(map);
      L.polyline(seg, { color: "#ffffff", weight: 2, dashArray: "6 6", opacity: 0.95 }).addTo(map);
      bounds.push(...seg);
    }
    if (src) {
      L.marker([src[1], src[0]], { icon: createPointIcon("A", "#C6FF4A", L) }).addTo(map).bindPopup("Pickup (Origin)");
      bounds.push([src[1], src[0]]);
    }
    if (dst) {
      L.marker([dst[1], dst[0]], { icon: createPointIcon("B", "#7B77FF", L) }).addTo(map).bindPopup("Drop (Destination)");
      bounds.push([dst[1], dst[0]]);
    }
    dashes.forEach((d) => {
      L.polyline([[d.from[1], d.from[0]], [d.to[1], d.to[0]]], {
        color: d.color, weight: 3, dashArray: "6 6", opacity: 0.95
      }).addTo(map);
      bounds.push([d.from[1], d.from[0]], [d.to[1], d.to[0]]);
    });
    pins.forEach((p) => {
      const isCar = p.iconType === "car" || /vehicle|car|driver|cab|🚗/i.test(p.label);
      const isPickup = p.iconType === "pickup";
      const isDrop = p.iconType === "dropoff";

      let icon;
      if (isCar) {
        icon = createCarIcon(p, L);
      } else if (isPickup) {
        icon = createPointIcon("A", p.color || "#0ea5e9", L);
      } else if (isDrop) {
        icon = createPointIcon("B", p.color || "#f43f5e", L);
      } else {
        icon = dot(p.color);
      }

      const marker = L.marker([p.lat, p.lng], {
        icon,
        zIndexOffset: isCar ? 1000 : 100,
      }).addTo(map);

      if (isCar) {
        marker.bindPopup(createCarPopup(p));
      } else {
        marker.bindPopup(p.label);
      }
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30] });
    // Dependencies are stringified: callers pass fresh arrays each render, and
    // raw array identity would redraw the layers on every parent re-render.
  }, [
    mapReady,
    routeColor,
    JSON.stringify(src), JSON.stringify(dst), JSON.stringify(geometry),
    JSON.stringify(pins), JSON.stringify(dashes),
    JSON.stringify(passengerSegment)
  ]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try { mapRef.current?.remove(); } catch {}
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="map-glow overflow-hidden rounded-xl3 border border-brand-teal/22">
      <div ref={divRef} style={{ height }} className="leaflet-night z-0" />
      <style>{`
        .leaflet-night .leaflet-tile-pane{filter:saturate(.7) brightness(.85) hue-rotate(-15deg);}
        @keyframes voltPulse {
          0% { transform: scale(0.85); opacity: 0.9; }
          70% { transform: scale(1.45); opacity: 0.15; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        .volt-car-divicon, .volt-point-divicon {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
}
