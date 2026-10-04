"use client";
// PlacePicker (Phase 3): type-to-search with typo tolerance, or pin a spot
// on the map. Replaces the old SearchBox, which could only autocomplete.
//
// Two sources are merged:
//   1. the local catalogue + fuzzy scorer (instant, offline, no login)
//   2. the backend Nominatim search (needs a token, so it is best-effort)
// The map reverse-geocodes the clicked point through /geo/reverse.
import { useEffect, useRef, useState } from "react";
import { geoApi, type PlaceHit } from "@/lib/geo";
import { searchCatalog, mergeSuggestions, type Suggestion } from "@/lib/fuzzy";
import { PickerMap } from "@/components/PickerMap";
import { inputCls } from "@/components/AuthShell";

export const PIN_COLOR = "#C6FF4A";

export function PlacePicker({
  label, value, onPick, placeholder = "Search or tap the map…"
}: {
  label: string;
  value: PlaceHit | null;
  onPick: (p: PlaceHit | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState(value?.name ?? "");
  const [hits, setHits] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [showMap, setShowMap] = useState(false);
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQ(value?.name ?? "");
    if (value) setPin([value.lng, value.lat]);
  }, [value]);

  // Local fuzzy hits are immediate; the remote call only tops up the list.
  const type = (v: string) => {
    setQ(v);
    setCursor(-1);
    if (timer.current) clearTimeout(timer.current);

    const local = searchCatalog(v, 6);
    setHits(local);
    setOpen(local.length > 0);

    if (v.trim().length < 3) return;
    timer.current = setTimeout(async () => {
      try {
        const remote = await geoApi.search(v.trim());
        const mapped: Suggestion[] = remote.map((r) => ({
          name: r.name,
          address: r.address,
          lat: r.lat,
          lng: r.lng,
          score: 70,
          reason: "map result",
          source: "nominatim"
        }));
        setHits((prev) => mergeSuggestions(prev, mapped, 8));
        setOpen(true);
      } catch {
        // Not logged in, or the geocoder is down: catalogue results stand.
      }
    }, 450); // courtesy debounce (Nominatim <=1 req/s)
  };

  const choose = (s: Suggestion) => {
    onPick({ name: s.name, address: s.address, lat: s.lat, lng: s.lng });
    setQ(s.name);
    setPin([s.lng, s.lat]);
    setOpen(false);
    setCursor(-1);
  };

  // Map click / pin drop -> reverse geocode for a real name.
  const dropPin = async (lng: number, lat: number) => {
    setPin([lng, lat]);
    setGeoBusy(true);
    try {
      const r = await geoApi.reverse(lat, lng);
      onPick(r);
      setQ(r.name);
    } catch {
      // Offline fallback: keep the raw coordinates.
      onPick({ name: "Pinned point", address: null, lat, lng });
      setQ("Pinned point");
    } finally {
      setGeoBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c <= 0 ? hits.length - 1 : c - 1));
    } else if (e.key === "Enter" && cursor >= 0) {
      e.preventDefault();
      choose(hits[cursor]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#A5ABD6]">
        {label}
      </span>
      <PlaceRow
        q={q}
        hits={hits}
        open={open}
        cursor={cursor}
        showMap={showMap}
        placeholder={placeholder}
        hasValue={!!value}
        onType={type}
        onHover={setCursor}
        onChoose={choose}
        onKeyDown={onKeyDown}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onToggleMap={() => setShowMap((s) => !s)}
        onClear={() => onPick(null)}
      />
      {showMap && (
        <div className="mt-2">
          <PickerMap
            pin={pin}
            label={value?.name ?? "Selected point"}
            onPick={dropPin}
          />
          <p className="mt-1 text-center text-[11px] text-[#5b6194]">
            {geoBusy
              ? "Looking up that spot…"
              : pin
                ? `Pinned ${pin[1].toFixed(4)}, ${pin[0].toFixed(4)} — click elsewhere to move it`
                : "Click anywhere on the map to drop your pickup point"}
          </p>
        </div>
      )}
    </div>
  );
}
/* Split out purely to keep this file readable; it holds no state of its own. */
function PlaceRow({
  q, hits, open, cursor, showMap, placeholder, hasValue,
  onType, onHover, onChoose, onKeyDown, onFocus, onBlur, onToggleMap, onClear
}: {
  q: string;
  hits: Suggestion[];
  open: boolean;
  cursor: number;
  showMap: boolean;
  placeholder: string;
  hasValue: boolean;
  onType: (v: string) => void;
  onHover: (i: number) => void;
  onChoose: (s: Suggestion) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
  onToggleMap: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input
          className={inputCls}
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            onType(e.target.value);
            // Editing invalidates the previous pick; the parent must know.
            if (hasValue) onClear();
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
        />
        {open && hits.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-[rgba(154,151,255,.3)] bg-night-950 shadow-card">
            {hits.map((h, i) => (
              <button
                key={`${h.lat},${h.lng},${i}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChoose(h);
                }}
                onMouseEnter={() => onHover(i)}
                className={`block w-full px-4 py-2 text-left text-sm transition ${
                  i === cursor ? "bg-night-800" : "hover:bg-night-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-[#EEF0FF]">{h.name}</span>
                  <span className="rounded-full bg-night-900 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-volt-300">
                    {h.source === "catalog" ? "known stop" : "map"}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="block truncate text-xs text-[#A5ABD6]">{h.address}</span>
                  <span className="shrink-0 text-[10px] text-iris-300">{h.reason}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onToggleMap}
        title={showMap ? "Hide map" : "Pick on map"}
        aria-pressed={showMap}
        className={`shrink-0 rounded-2xl border px-3 text-sm transition ${
          showMap
            ? "border-volt-400 bg-volt-400/15 text-volt-300"
            : "border-[rgba(154,151,255,.3)] text-[#A5ABD6] hover:border-volt-400/60 hover:text-volt-300"
        }`}
      >
        {showMap ? "✕" : "📍"}
      </button>
    </div>
  );
}