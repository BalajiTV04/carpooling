"use client";
// Login: phone + password → session saved → redirect to ?next= or /me.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";

function LoginForm() {
  const { login, error } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/me";
  const [form, setForm] = useState({ phone: "", password: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(form.phone, form.password);
      router.push(next);
    } catch { /* context error */ } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Welcome back" sub="Log in with your verified phone number.">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Phone">
          <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919876543210" required />
        </Field>
        <Field label="Password">
          <input className={inputCls} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        {error && <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        <button disabled={busy} className="rounded-2xl bg-volt-400 py-2.5 text-sm font-bold text-night-950 shadow-glow disabled:opacity-60">
          {busy ? "Checking…" : "Log in →"}
        </button>
        <p className="text-center text-sm text-[#A5ABD6]">
          New here? <a href="/register" className="text-volt-300">Create account</a>
        </p>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-[#A5ABD6]">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
