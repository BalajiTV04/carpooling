"use client";
// Register: phone + name + password + strictly one role: driver or passenger (plus vehicle mileage for drivers).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Car, UserCheck, Gauge } from "lucide-react";

export default function RegisterPage() {
  const { register, error } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({ phone: "+91", full_name: "", password: "" });
  const [role, setRole] = useState<"passenger" | "driver">("passenger");
  const [mileage, setMileage] = useState("15.0");
  const [availableSeats, setAvailableSeats] = useState("1");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const parsedMileage = role === "driver" ? parseFloat(mileage) || 15.0 : undefined;
      const parsedAvailableSeats = role === "driver" ? parseInt(availableSeats, 10) || 1 : undefined;
      await register({
        ...form,
        roles: [role],
        mileage: parsedMileage,
        available_seats: parsedAvailableSeats,
      });
      router.push("/verify?fresh=1");
    } catch {
      /* error shown from context */
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create account" sub="Choose your account type. Phone is your login key.">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Phone (E.164)">
          <input
            className={inputCls}
            type="tel"
            pattern="\\+91[0-9]{10}"
            name="phone"
            title="Must start with +, e.g. +919876543210"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+919876543210"
            required
          />
          <span className="mt-1 block text-[11px] text-muted">
            Starts with <b className="text-brand-teal">+</b> — e.g.{" "}
            <span className="text-brand-teal">+919876543210</span>
          </span>
        </Field>

        <Field label="Full name">
          <input
            className={inputCls}
            name="full_name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="Asha Kumar"
            minLength={2}
            required
          />
        </Field>

        <Field label="Password (min 6)">
          <input
            className={inputCls}
            name="password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={6}
            required
          />
        </Field>

        {/* Role selection: ONLY ONE option either Driver or Passenger (not both) */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted">
            Select Account Type (Choose one)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole("passenger")}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition ${
                role === "passenger"
                  ? "border-brand-teal bg-brand-teal/10 text-brand-teal ring-2 ring-brand-teal/20"
                  : "border-line bg-surface text-muted hover:border-brand-teal/40 hover:text-ink"
              }`}
            >
              <UserCheck className="h-6 w-6" />
              <div>
                <p className="text-sm font-bold text-ink">Passenger</p>
                <p className="text-[11px] text-muted">Book rides & travel</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRole("driver")}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition ${
                role === "driver"
                  ? "border-brand-teal bg-brand-teal/10 text-brand-teal ring-2 ring-brand-teal/20"
                  : "border-line bg-surface text-muted hover:border-brand-teal/40 hover:text-ink"
              }`}
            >
              <Car className="h-6 w-6" />
              <div>
                <p className="text-sm font-bold text-ink">Driver</p>
                <p className="text-[11px] text-muted">Host trips & share fuel</p>
              </div>
            </button>
          </div>
        </div>

        {/* Driver specific field: Vehicle Mileage */}
        {role === "driver" && (
          <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4 animate-in fade-in">
            <Field label="Vehicle Mileage (km/L)">
              <div className="relative">
                <input
                  className={`${inputCls} pl-10`}
                  type="number"
                  step="0.1"
                  min="5"
                  max="50"
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  placeholder="e.g. 15.0"
                  required
                />
                <Gauge className="absolute left-3 top-3 h-4 w-4 text-brand-teal" />
              </div>
              <span className="mt-1.5 block text-[11px] text-muted">
                Used to calculate fair fuel costs: <b>(Distance / Mileage) × Fuel Price</b>.
              </span>
            </Field>

            <Field label="Available Passenger Seats (excludes your driver seat)">
              <select
                className={inputCls}
                value={availableSeats}
                onChange={(e) => setAvailableSeats(e.target.value)}
                required
              >
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={String(n)}>
                    {n} passenger seat{n > 1 ? "s" : ""} (vehicle total {n + 1})
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11px] text-muted">
                One seat is reserved for you (the driver). Bike → 1 passenger seat; 5-seater car → 4.
              </span>
            </Field>
          </div>
        )}

        {error && <Alert variant="danger">{error}</Alert>}

        <Button variant="primary" size="md" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create & verify phone →"}
        </Button>

        <p className="text-center text-sm text-muted">
          Have an account? <a href="/login" className="link-volt">Log in</a>
        </p>
      </form>
    </AuthShell>
  );
}
