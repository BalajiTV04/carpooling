"use client";
// TripCostCard: driver-side pricing console block (Module 12).
// Policy picker + fuel price override + live totals + per-seat estimate +
// what each confirmed passenger currently owes.
import { useCallback, useEffect, useState } from "react";
import {
  costApi, POLICY_BLURBS, type CostPolicy, type TripCost
} from "@/lib/cost";
import { Field, inputCls } from "@/components/AuthShell";
import { SegmentView } from "@/components/SegmentView";

export function TripCostCard({ tripId, seatsLeft }: { tripId: string; seatsLeft: number }) {
  const [cost, setCost] = useState<TripCost | null>(null);
  const [mode, setMode] = useState<CostPolicy>("split_equal");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    () => costApi.trip(tripId).then((c) => { setCost(c); setMode(c.policy.mode); }).catch(() => {}),
    [tripId]
  );
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setErr(null);
    setMsg(null);
    try {
      await costApi.setPricing(tripId, {
        mode, fuel_price: price === "" ? undefined : Number(price)
      });
      await load();
      setMsg("Pricing saved — confirmed shares recalculated ✓");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-[rgba(154,151,255,.3)] bg-night-950 p-3">
      <p className="text-xs font-bold text-[#EEF0FF]">Cost & sharing</p>
      {cost && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-night-900 px-2 py-2">
            <p className="font-display text-base font-bold text-volt-300">₹{cost.fuel.total_cost}</p>
            <p className="text-[10px] uppercase tracking-wider text-[#A5ABD6]">trip fuel</p>
          </div>
          <div className="rounded-2xl bg-night-900 px-2 py-2">
            <p className="font-display text-base font-bold text-iris-300">₹{cost.per_seat_estimate}</p>
            <p className="text-[10px] uppercase tracking-wider text-[#A5ABD6]">per seat</p>
          </div>
          <div className="rounded-2xl bg-night-900 px-2 py-2">
            <p className="font-display text-base font-bold text-[#EEF0FF]">₹{cost.collected_total}</p>
            <p className="text-[10px] uppercase tracking-wider text-[#A5ABD6]">collected</p>
          </div>
        </div>
      )}
      {/* The arithmetic behind the total. total = km ÷ mileage × price, so the
          mileage and the car it came from must both be on screen — a bare
          "₹344" is unverifiable. Shown as: identity · fuel inputs · working. */}
      {cost ? (
        <div className="mt-2 rounded-2xl bg-night-900 p-2.5 text-[11px]">
          <p className="truncate text-[#EEF0FF]">
            <span className="font-semibold">
              {cost.vehicle.make ?? "Car"} {cost.vehicle.model ?? ""}
            </span>
            {cost.vehicle.year ? <span className="text-[#A5ABD6]"> · {cost.vehicle.year}</span> : null}
            {cost.vehicle.plate_no ? <span className="font-mono text-volt-300"> · {cost.vehicle.plate_no}</span> : null}
            {cost.vehicle.color ? <span className="text-[#A5ABD6]"> · {cost.vehicle.color}</span> : null}
          </p>
          <p className="mt-0.5 text-[#A5ABD6]">
            {cost.vehicle.fuel_type ?? "fuel"} ·{" "}
            <span className="font-semibold text-volt-300">{cost.fuel.mileage_kmpl} kmpl</span>
            {cost.vehicle.mileage_kmpl === null ? (
              <span className="text-[10px] text-[#5b6194]"> (project default)</span>
            ) : null}
            {" · "}₹{cost.fuel.fuel_price}/L
          </p>
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[#5b6194]">
            {cost.fuel.distance_km} km ÷ {cost.fuel.mileage_kmpl} kmpl = {cost.fuel.litres} L
            {" × "}₹{cost.fuel.fuel_price} ={" "}
            <span className="text-volt-300">₹{cost.fuel.total_cost}</span>
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-[#5b6194]">Loading…</p>
      )}
      <div className="mt-2 grid gap-2">
        <Field label="Sharing policy">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as CostPolicy)}>
            {(Object.keys(POLICY_BLURBS) as CostPolicy[]).map((m) => (
              <option key={m} value={m}>{m.replace("_", " ")}</option>
            ))}
          </select>
        </Field>
        <p className="text-[11px] text-[#A5ABD6]">{POLICY_BLURBS[mode]}</p>
        <Field label="Fuel price ₹/unit (blank = default)">
          <input className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 104.5" />
        </Field>
        <button onClick={save} className="rounded-2xl bg-volt-400 py-2 text-xs font-bold text-night-950">
          Save pricing
        </button>
        {msg && <p className="text-[11px] text-volt-300">{msg}</p>}
        {err && <p className="text-[11px] text-rose-300">{err}</p>}
      </div>
      {/* Module 13: leg-by-leg breakdown + recalculation trigger */}
      <SegmentView tripId={tripId} canRebuild />
    </div>
  );
}