"use client";
// Vehicle add/edit form (shared by /garage; admin console reuses read-only card).
import { Field, inputCls } from "@/components/AuthShell";

export type VehicleFormState = {
  make: string; model: string; year: string; color: string;
  plate_no: string; seats_total: string; seat_capacity: string; fuel_type: string;
  mileage_kmpl: string; image_url: string;
  mileage_err: string; seats_err: string;
};

export const EMPTY_VEHICLE: VehicleFormState = {
  make: "", model: "", year: "", color: "",
  plate_no: "", seats_total: "3", seat_capacity: "4", fuel_type: "petrol",
  mileage_kmpl: "18", image_url: "",
  mileage_err: "", seats_err: "",
};

export function VehicleForm({
  form, setForm, editing, onSubmit, onCancel
}: {
  form: VehicleFormState;
  setForm: (f: VehicleFormState) => void;
  editing: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const fuelLabel = (form.fuel_type === "cng" ? "km/kg" :
                     form.fuel_type === "ev" ? "km/kWh" : "km/litre");

  return (
    <form onSubmit={onSubmit} className="panel mt-5 grid gap-3 p-5">
      <h2 className="font-display font-bold">{editing ? "Edit car" : "Add a car"}</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Make"><input className={inputCls} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} required /></Field>
        <Field label="Model"><input className={inputCls} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></Field>
        <Field label="Plate (any spacing)"><input className={inputCls} value={form.plate_no} onChange={(e) => setForm({ ...form, plate_no: e.target.value })} placeholder="KA 05 MN 1234" required /></Field>
        <Field label="Total seats (incl. driver)">
          <select className={inputCls} value={form.seat_capacity} onChange={(e) => {
            const v = e.target.value;
            setForm({ ...form, seat_capacity: v, seats_total: String(Math.max(1, Number(v) - 1)), seats_err: "" });
          }}>
            {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {form.seats_err && <span className="text-[10px] text-rose-400">{form.seats_err}</span>}
        </Field>
        <Field label="Fuel">
          <select className={inputCls} value={form.fuel_type} onChange={(e) => setForm({ ...form, fuel_type: e.target.value })}>
            {["petrol", "diesel", "cng", "ev", "hybrid"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label={`Mileage (${fuelLabel}) — required to host trips`}>
          <input className={inputCls} value={form.mileage_kmpl} onChange={(e) => {
            const v = e.target.value;
            let err = "";
            const n = Number(v);
            if (v !== "" && (!isFinite(n) || n < 3 || n > 60)) err = "Enter 3–60";
            setForm({ ...form, mileage_kmpl: v, mileage_err: err });
          }} inputMode="decimal" placeholder="18" required />
          {form.mileage_err && <span className="text-[10px] text-rose-400">{form.mileage_err}</span>}
        </Field>
        <Field label="Year"><input className={inputCls} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} inputMode="numeric" placeholder="2019" /></Field>
        <Field label="Color"><input className={inputCls} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="Blue" /></Field>
      </div>
      {/* Full width: long URLs wrap badly in the 2-col grid. URL-only (no
          upload) — same rule as the old profile avatar: http(s)://, blank clears. */}
      <Field label="Car photo (https image URL — blank = 🚗)">
        <input className={inputCls} value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://…/my-car.jpg" />
      </Field>
      <div className="flex gap-2">
        <button className="btn btn-primary flex-1 py-3" disabled={!!form.mileage_err || !!form.seats_err}>
          {editing ? "Save (resets verification)" : "Add car →"}
        </button>
        {editing && (
          <button type="button" onClick={onCancel} className="btn btn-ghost px-4">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
