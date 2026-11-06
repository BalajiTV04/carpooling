"use client";
// /garage (driver console): my cars + add/edit/deactivate.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RequireAuth } from "@/components/RequireAuth";
import { vehicleApi, badge, type Vehicle } from "@/lib/vehicles";
import { Car } from "lucide-react";
import { Field, inputCls } from "@/components/AuthShell";
import { VehicleForm, EMPTY_VEHICLE, type VehicleFormState } from "@/components/VehicleForm";
import { VehicleCard } from "@/components/VehicleCard";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

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
          Only <span className="text-brand-teal">verified</span> cars publish trips.
        </>
      }
    >
      {msg && <Alert variant="success" className="mt-6">{msg}</Alert>}
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 glass-card p-6"
      >
        <VehicleForm
          form={form} setForm={setForm} editing={editing}
          onSubmit={submit}
          onCancel={() => { setEditing(null); setForm(EMPTY_VEHICLE); }}
        />
      </motion.div>
      <div className="mt-8 grid gap-4">
        {cars.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="empty-state"
          >
            <div className="empty-icon">
              <Car className="h-6 w-6 text-muted" />
            </div>
            <p className="text-sm text-muted">
              No cars yet — add your first above. It starts as pending.
            </p>
          </motion.div>
        )}
        {cars.map((v) => (
          <motion.div
            key={v.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: cars.indexOf(v) * 0.05 }}
            whileHover={{ y: -2 }}
            className="glass-card p-5"
          >
            <VehicleCard key={v.id} v={v} badgeCls={badge(v.verification_status)} onEdit={() => startEdit(v)} onRemove={() => remove(v.id)} />
          </motion.div>
        ))}
      </div>
    </PageShell>
  );
}