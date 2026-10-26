"use client";
// /garage (driver console): my cars + add/edit/deactivate. Pending banner
// explains the publish gate enforced in Module 6.
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { vehicleApi, badge, type Vehicle } from "@/lib/vehicles";
import { Field, inputCls } from "@/components/AuthShell";
import { VehicleForm, EMPTY_VEHICLE, type VehicleFormState } from "@/components/VehicleForm";
import { VehicleCard } from "@/components/VehicleCard";
import { PageShell } from "@/components/PageShell";

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
    <PageShell
      title="My garage"
      eyebrow="Driver"
      accent="· cars"
      subtitle={
        <>
          Only <span className="text-brand-teal">verified</span> cars publish trips (Module 6).
        </>
      }
    >
      {msg && <p className="alert alert-ok mt-4">{msg}</p>}
      {err && <p className="alert alert-err mt-4">{err}</p>}
      <VehicleForm
        form={form} setForm={setForm} editing={editing}
        onSubmit={submit}
        onCancel={() => { setEditing(null); setForm(EMPTY_VEHICLE); }}
      />
      <div className="mt-4 grid gap-3">
        {cars.length === 0 && (
          <div className="empty">
            No cars yet — add your first above. It starts as pending.
          </div>
        )}
        {cars.map((v) => (
          <VehicleCard key={v.id} v={v} badgeCls={badge(v.verification_status)} onEdit={() => startEdit(v)} onRemove={() => remove(v.id)} />
        ))}
      </div>
    </PageShell>
  );
}
