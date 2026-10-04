"use client";
// Verify: request dev OTP → enter 6 digits → phone_verified flips.
// Shows the dev code on screen (no paid SMS in this project).
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { authApi, saveSession, loadSession } from "@/lib/auth";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";

function VerifyForm() {
  const { user, setVerified } = useSession();
  const router = useRouter();
  const fresh = useSearchParams().get("fresh");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [msg, setMsg] = useState(
    fresh ? "Account created — request your code below." : "Enter the 6-digit code sent to your phone."
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setErr(null);
    try {
      const r = await authApi.otpRequest(phone || user?.phone || "");
      setDevCode(r.dev_code ?? null);
      setMsg("Code sent — valid 10 min, 5 tries. (Dev build shows it here.)");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Request failed");
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await authApi.otpVerify(phone || user?.phone || "", code);
      const s = loadSession();
      if (s.token) saveSession(r.access_token ?? s.token, r.user);
      setVerified();
      setMsg("Verified ✓ — taking you to your profile…");
      setTimeout(() => router.push("/me"), 700);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Verify failed");
    } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Verify phone" sub="One 6-digit code. 10 minutes. 5 tries.">
      <div className="grid gap-4">
        <Field label="Phone">
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
        </Field>
        <button onClick={request} className="rounded-2xl border border-volt-400/60 py-2.5 text-sm font-bold text-volt-300">
          Send code
        </button>
        {devCode && (
          <p className="rounded-2xl border border-dashed border-volt-400/60 bg-night-950 p-3 text-center">
            <span className="text-xs text-[#A5ABD6]">DEV CODE (no SMS in project): </span>
            <span className="font-display text-xl font-bold tracking-[.3em] text-volt-300">{devCode}</span>
          </p>
        )}
        <form onSubmit={verify} className="grid gap-3">
          <Field label="6-digit code">
            <input
              className={inputCls + " text-center text-2xl tracking-[.4em]"}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" placeholder="••••••" required
            />
          </Field>
          <button disabled={busy} className="rounded-2xl bg-volt-400 py-2.5 text-sm font-bold text-night-950 shadow-glow disabled:opacity-60">
            {busy ? "Verifying…" : "Verify →"}
          </button>
        </form>
        <p className="text-sm text-[#A5ABD6]">{msg}</p>
        {err && <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      </div>
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-[#A5ABD6]">Loading…</p>}>
      <VerifyForm />
    </Suspense>
  );
}
