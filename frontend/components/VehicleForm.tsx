// Vehicle add/edit form (shared by /garage; admin console reuses read-only card).
import { Field, inputCls } from "@/components/AuthShell";

export type VehicleFormState = {
  make: string; model: string; year: string; color: string;
  plate_no: string; seats_total: string; fuel_type: string; mileage_kmpl: string;
  image_url: string;
};

export const EMPTY_VEHICLE: VehicleFormState = {
  make: "", model: "", year: "", color: "",
  plate_no: "", seats_total: "3", fuel_type: "petrol", mileage_kmpl: "",
  image_url: ""
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
  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
      <h2 className="font-display font-bold">{editing ? "Edit car" : "Add a car"}</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Make"><input className={inputCls} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} required /></Field>
        <Field label="Model"><input className={inputCls} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></Field>
        <Field label="Plate (any spacing)"><input className={inputCls} value={form.plate_no} onChange={(e) => setForm({ ...form, plate_no: e.target.value })} placeholder="KA 05 MN 1234" required /></Field>
        <Field label="Seats (passengers)">
          <select className={inputCls} value={form.seats_total} onChange={(e) => setForm({ ...form, seats_total: e.target.value })}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Fuel">
          <select className={inputCls} value={form.fuel_type} onChange={(e) => setForm({ ...form, fuel_type: e.target.value })}>
            {["petrol", "diesel", "cng", "ev", "hybrid"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Mileage kmpl (cost split)">
          <input className={inputCls} value={form.mileage_kmpl} onChange={(e) => setForm({ ...form, mileage_kmpl: e.target.value })} inputMode="decimal" placeholder="18" />
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
        <button className="flex-1 rounded-2xl bg-volt-400 py-2.5 text-sm font-bold text-night-950 shadow-glow">
          {editing ? "Save (resets verification)" : "Add car →"}
        </button>
        {editing && (
          <button type="button" onClick={onCancel} className="rounded-2xl border border-[rgba(154,151,255,.35)] px-4 text-sm">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
