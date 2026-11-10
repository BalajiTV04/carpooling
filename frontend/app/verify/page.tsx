"use client";
// /verify: OTP phone verification with dev OTP fallback and role-based redirect.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/components/SessionProvider";
import { authApi, saveSession } from "@/lib/auth";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Shield, Sparkles } from "lucide-react";

function VerifyForm() {
  const { user, setVerified } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isFresh = searchParams.get("fresh");

  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const phone = user?.phone;

  const requestOtp = useCallback(async () => {
    if (!phone) return;
    setErr(null);
    try {
      const res = await authApi.otpRequest(phone);
      if (res?.dev_code) {
        setDevCode(res.dev_code);
        setCode(res.dev_code);
        setMsg(`Dev mode active: OTP code ${res.dev_code} autofilled.`);
      } else {
        setMsg("Verification code sent to your phone.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to send code");
    }
  }, [phone]);

  useEffect(() => {
    if (phone && isFresh) {
      void requestOtp();
    }
  }, [phone, isFresh, requestOtp]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) {
      setErr("Phone number missing. Please log in first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await authApi.otpVerify(phone, code);
      saveSession(res.access_token, res.user);
      setVerified();
      if (res.user?.roles?.includes("driver")) {
        router.push("/driver");
      } else {
        router.push("/passenger");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid verification code");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Verify your phone"
      sub={phone ? `We sent a 6-digit code to ${phone}` : "Enter the 6-digit code sent to your phone."}
    >
      {err && <Alert variant="danger">{err}</Alert>}
      {msg && <Alert variant="success">{msg}</Alert>}

      {devCode && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-brand-teal/30 bg-brand-teal/10 p-3 text-xs text-brand-teal">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span>Demo verification code: <b>{devCode}</b></span>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-4">
        <Field label="Verification code">
          <input
            className={inputCls}
            type="text"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            required
          />
        </Field>

        <div className="flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-brand-teal" />
            Instant verification
          </span>
          <button
            type="button"
            onClick={requestOtp}
            className="text-brand-teal font-medium hover:underline"
          >
            Resend code
          </button>
        </div>

        <Button variant="primary" size="md" disabled={busy || code.length !== 6} className="w-full">
          {busy ? "Verifying…" : "Verify & Continue →"}
        </Button>

        <p className="text-center text-sm text-muted">
          Skip for now?{" "}
          <Link
            href={user?.roles?.includes("driver") ? "/driver" : "/passenger"}
            className="link-volt"
          >
            Go to dashboard
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center">
          <div className="loader mx-auto mb-2" />
        </div>
      }
    >
      <VerifyForm />
    </Suspense>
  );
}
