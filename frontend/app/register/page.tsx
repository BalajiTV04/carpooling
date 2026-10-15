"use client";
// Register: phone + name + password + role toggle (passenger/driver/both).
// On success → straight to /verify (OTP step), token already saved.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";

export default function RegisterPage() {
  const { register, error } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({ phone: "+91", full_name: "", password: "" });
  const [roles, setRoles] = useState<("driver" | "passenger")[]>(["passenger"]);
  const [busy, setBusy] = useState(false);

  const toggle = (r: "driver" | "passenger") =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roles.length === 0) return;
    setBusy(true);
    try {
      await register({ ...form, roles });
      router.push("/verify?fresh=1");
    } catch { /* error shown from context */ } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Create account" sub="Phone is your login key. Verify it with a 6-digit code next.">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Phone (E.164)">
          <input
            className={inputCls}
            type="tel"
            pattern="\+[0-9]{7,15}"
            title="Must start with +, e.g. +919876543210"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+919876543210"
            required
          />
          <span className="mt-1 block text-[11px] text-muted">
            Starts with <b className="text-volt-300">+</b> — e.g.{" "}
            <span className="text-volt-300">+919876543210</span>
          </span>
        </Field>
        <Field label="Full name">
          <input className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Asha Kumar" minLength={2} required />
        </Field>
        <Field label="Password (min 6)">
          <input className={inputCls} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required />
        </Field>
        <div>
          <span className="label">I will use VoltRide as</span>
          <div className="flex gap-2">
            {(["passenger", "driver"] as const).map((r) => (
              <button
                key={r} type="button" onClick={() => toggle(r)}
                className={`btn flex-1 ${roles.includes(r) ? "btn-primary" : "btn-ghost"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="alert alert-err">{error}</p>}
        <button disabled={busy} className="btn btn-primary w-full py-3">
          {busy ? "Creating…" : "Create & verify phone →"}
        </button>
        <p className="text-center text-sm text-muted">
          Have an account? <a href="/login" className="link-volt">Log in</a>
        </p>
      </form>
    </AuthShell>
  );
}
