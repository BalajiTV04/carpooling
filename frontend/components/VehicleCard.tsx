"use client";
// Garage car card: plate-first layout + verification badge + actions.
// Photo (Module 5, URL-only) replaces the emoji tile when a driver supplied a
// URL, with a hard fallback: a dead/offline image degrades to 🚗 rather than
// leaving a broken-image hole in the card.
import { useEffect, useState } from "react";
import type { Vehicle } from "@/lib/vehicles";

export function VehicleCard({
  v, badgeCls, onEdit, onRemove
}: {
  v: Vehicle; badgeCls: string; onEdit: () => void; onRemove: () => void;
}) {
  const [broken, setBroken] = useState(false);
  // Reset when the row changes (e.g. the URL was edited) so the new photo
  // gets a fresh attempt instead of inheriting the last failure.
  useEffect(() => { setBroken(false); }, [v.image_url]);
  const showPhoto = !!v.image_url && !broken;

  return (
    <div className="panel panel-hover flex items-center gap-4 p-4">
      {showPhoto ? (
        <img
          src={v.image_url as string}
          alt={`${v.make} ${v.model}`}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-14 w-14 shrink-0 rounded-2xl border border-brand-teal/26 bg-surface object-cover"
        />
      ) : (
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-brand-teal/26 bg-surface font-display text-xl">🚗</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-display font-bold">{v.make} {v.model} <span className="text-xs font-normal text-muted">{v.year ?? ""}</span></p>
        <p className="font-mono text-sm text-brand-teal">{v.plate_no}</p>
        <p className="text-xs text-muted">{v.seats_total} seats · {v.fuel_type}{v.mileage_kmpl ? ` · ${v.mileage_kmpl} kmpl` : ""}</p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeCls}`}>{v.verification_status}</span>
        <div className="flex gap-1.5">
          <button onClick={onEdit} className="btn btn-ghost btn-sm">Edit</button>
          <button onClick={onRemove} className="btn btn-danger btn-sm">Off</button>
        </div>
      </div>
    </div>
  );
}
