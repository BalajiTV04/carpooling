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
        {error && <p className="alert alert-err">{error}</p>}
        <button disabled={busy} className="btn btn-primary w-full py-3">
          {busy ? "Checking…" : "Log in →"}
        </button>
        <p className="text-center text-sm text-muted">
          New here? <a href="/register" className="link-volt">Create account</a>
        </p>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-muted">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
