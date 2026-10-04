"use client";
// /garage (driver console): my cars + add/edit/deactivate. Pending banner
// explains the publish gate enforced in Module 6.
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { vehicleApi, badge, type Vehicle } from "@/lib/vehicles";
import { Field, inputCls } from "@/components/AuthShell";
import { VehicleForm, EMPTY_VEHICLE, type VehicleFormState } from "@/components/VehicleForm";
import { VehicleCard } from "@/components/VehicleCard";

export default function GaragePage() {
  return (
    <RequireAuth roles={["driver"]}>
      <GarageInner />
    </RequireAuth>
  );
}

function GarageInner() {
  const [cars, setCars] = useState<Vehicle[]>([]);
  const [form, setForm] = useState<VehicleFormState>(EMPTY_VEHICLE);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => vehicleApi.list().then(setCars).catch((e: unknown) => setErr(e instanceof Error ? e.message : "Load failed"));
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const body = {
      make: form.make, model: form.model,
      year: form.year === "" ? undefined : Number(form.year),
      color: form.color || undefined, plate_no: form.plate_no,
      seats_total: Number(form.seats_total), fuel_type: form.fuel_type,
      mileage_kmpl: form.mileage_kmpl === "" ? undefined : Number(form.mileage_kmpl),
      // Always sent (even blank) so the backend can tell "clear the photo"
      // apart from "leave it alone" via model_fields_set.
      image_url: form.image_url.trim() === "" ? null : form.image_url.trim()
    };
    try {
      if (editing) {
        await vehicleApi.update(editing, body);
        setMsg("Saved — verification reset to pending (re-check needed) ✓");
      } else {
        await vehicleApi.create(body);
        setMsg("Car added — pending admin verification ✓");
      }
      setForm(EMPTY_VEHICLE);
      setEditing(null);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  };

  const startEdit = (v: Vehicle) => {
    setEditing(v.id);
    setForm({
      make: v.make, model: v.model, year: v.year?.toString() ?? "",
      color: v.color ?? "", plate_no: v.plate_no,
      seats_total: String(v.seats_total), fuel_type: v.fuel_type,
      mileage_kmpl: v.mileage_kmpl?.toString() ?? "",
      image_url: v.image_url ?? ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id: string) => {
    if (!confirm("Deactivate this car? Trip history is kept.")) return;
    await vehicleApi.remove(id);
    await load();
  };

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20 pt-10">
      <a href="/" className="text-sm text-volt-300">← VoltRide</a>
      <h1 className="font-display mt-2 text-3xl font-bold">My garage</h1>
      <p className="mt-1 text-sm text-[#A5ABD6]">
        Only <span className="text-volt-300">verified</span> cars publish trips (Module 6).
      </p>
      {msg && <p className="mt-3 rounded-2xl border border-volt-400/40 bg-volt-400/10 p-3 text-sm text-volt-300">{msg}</p>}
      {err && <p className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      <VehicleForm
        form={form} setForm={setForm} editing={editing}
        onSubmit={submit}
        onCancel={() => { setEditing(null); setForm(EMPTY_VEHICLE); }}
      />
      <div className="mt-4 grid gap-3">
        {cars.length === 0 && (
          <div className="rounded-xl3 border border-dashed border-[rgba(154,151,255,.35)] p-8 text-center text-sm text-[#A5ABD6]">
            No cars yet — add your first above. It starts as pending.
          </div>
        )}
        {cars.map((v) => (
          <VehicleCard key={v.id} v={v} badgeCls={badge(v.verification_status)} onEdit={() => startEdit(v)} onRemove={() => remove(v.id)} />
        ))}
      </div>
    </main>
  );
}
