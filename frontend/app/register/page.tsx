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
          <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919876543210" required />
        </Field>
        <Field label="Full name">
          <input className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Asha Kumar" minLength={2} required />
        </Field>
        <Field label="Password (min 6)">
          <input className={inputCls} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#A5ABD6]">I will use VoltRide as</span>
          <div className="flex gap-2">
            {(["passenger", "driver"] as const).map((r) => (
              <button
                key={r} type="button" onClick={() => toggle(r)}
                className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold capitalize ${
                  roles.includes(r) ? "border-volt-400 bg-volt-400 text-night-950" : "border-[rgba(154,151,255,.3)] text-[#A5ABD6]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        <button disabled={busy} className="rounded-2xl bg-volt-400 py-2.5 text-sm font-bold text-night-950 shadow-glow disabled:opacity-60">
          {busy ? "Creating…" : "Create & verify phone →"}
        </button>
        <p className="text-center text-sm text-[#A5ABD6]">
          Have an account? <a href="/login" className="text-volt-300">Log in</a>
        </p>
      </form>
    </AuthShell>
  );
}
