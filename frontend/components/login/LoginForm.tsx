// Login form: email/phone + password with show/hide toggle.
// Validates role match via the backend (403 -> clear message).
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Eye, EyeOff, Mail, Lock, Phone } from "lucide-react";

interface LoginFormProps {
  role: "driver" | "passenger";
  next?: string;
  className?: string;
}

export function LoginForm({ role, next: nextParam = "/", className }: LoginFormProps) {
  const { login, error, ready } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? nextParam ?? "/";
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(form.identifier, form.password, role);
      router.push(next);
    } catch {
      /* context error shown via Alert */
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className={cn("flex items-center justify-center min-h-[300px]", className)}>
        <p className="text-sm text-muted">Loading session…</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={cn("grid gap-4", className)}>
      <div className="flex items-center gap-2 text-xs font-semibold text-ink/90 uppercase tracking-wider mb-2">
        <Phone className="h-4 w-4" />
        <span>Sign in as {role === "driver" ? "Driver" : "Passenger"}</span>
      </div>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
        <input
          className="input pl-10"
          type="text"
          autoComplete="username"
          value={form.identifier}
          onChange={(e) => setForm({ ...form, identifier: e.target.value })}
          placeholder="you@example.com or +919876543210"
          required
        />
      </div>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
        <input
          className="input pl-10 pr-10"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="••••••••"
          required
        />
        <button
          type="button"
          onClick={() => setShowPassword((p) => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-brand transition-colors"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      <Button variant="primary" size="md" disabled={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in →"}
      </Button>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <a href={`/register?role=${role}`} className="link-volt">
          Create {role === "driver" ? "driver" : "passenger"} account
        </a>
      </p>
    </form>
  );
}