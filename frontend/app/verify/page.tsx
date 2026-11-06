"use client";
// /verify: OTP phone verification.
import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSession } from "@/components/SessionProvider";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Shield, Phone } from "lucide-react";

export default function VerifyPage() {
  const { verify, error } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await verify(code);
    } catch { /* context error */ } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Verify your phone" sub="Enter the 6-digit code sent to your number.">
      <Alert variant="danger">{error}</Alert>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Verification code">
          <input
            className={inputCls}
            type="text"
            maxLength="6"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            required
          />
        </Field>
        <div className="flex items-center gap-3 text-xs text-muted">
          <Shield className="h-4 w-4" />
          Didn&apos;t receive a code? <button onClick={() => {}} className="text-brand-teal font-medium hover:underline">Resend</button>
        </div>
        <Button variant="primary" size="md" disabled={busy || code.length !== 6} className="w-full">
          {busy ? "Verifying…" : "Verify code →"}
        </Button>
        <p className="text-center text-sm text-muted">
          Already verified? <Link href="/me" className="link-volt">Go to profile</Link>
        </p>
      </form>
    </AuthShell>
  );
}