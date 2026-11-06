"use client";
import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Eye, EyeOff, Lock, Mail, Phone, User } from "lucide-react";

type Role = "driver" | "passenger";

interface RegisterFormProps {
  role: Role;
  next?: string;
  className?: string;
}

export function RegisterForm({ role, next: nextParam = "/", className }: RegisterFormProps) {
const [busy, setBusy] = useState(false);
  const { register, error } = useSession();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [terms, setTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [passwordStrength, setPasswordStrength] = useState(0);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    confirm_password: "",
    licence_number: "",
    vehicle_type: "",
    vehicle_model: "",
    vehicle_plate: "",
    vehicle_seats: "4",
    vehicle_fuel: "petrol",
  });

  const setField = (k: string, v: string) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const passwordStrengthMeter = useCallback((pw: string) => {
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  }, []);

  const validate = useCallback(() => {
    const errs: Record<string, string> = {};
    if (!form.full_name.trim()) errs.full_name = "Full name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Enter a valid email";
    if (!form.phone.trim()) errs.phone = "Phone is required";
    else if (!/^\+[0-9]{7,15}$/.test(form.phone)) errs.phone = "Use E.164 format, e.g. +919876543210";
    if (!form.password) errs.password = "Password is required";
    else if (form.password.length < 6) errs.password = "Password must be at least 6 characters";
    if (!form.confirm_password) errs.confirm_password = "Confirm your password";
    else if (form.confirm_password !== form.password) errs.confirm_password = "Passwords do not match";
    if (!terms) errs.terms = "You must agree to the terms";
    if (role === "driver") {
      if (!form.licence_number.trim()) errs.licence_number = "Driving licence number is required";
      if (!form.vehicle_type.trim()) errs.vehicle_type = "Vehicle type is required";
      if (!form.vehicle_model.trim()) errs.vehicle_model = "Vehicle model is required";
      if (!form.vehicle_plate.trim()) errs.vehicle_plate = "Number plate is required";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form, role, terms]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const payload: any = {
        phone: form.phone,
        email: form.email,
        password: form.password,
        full_name: form.full_name.trim(),
        roles: [role],
      };
      await register(payload);
      router.push("/verify?fresh=1&next=" + encodeURIComponent(nextParam));
    } catch {
      /* context error shown via Alert */
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className={cn("flex items-center justify-center min-h-[400px]", className)}>
        <p className="text-sm text-muted">Loading session…</p>
      </div>
    );
  }

  const strengthLabel = ["Too short", "Weak", "Fair", "Good", "Strong"][passwordStrength];
  const strengthColor = ["text-danger", "text-warn", "text-warn", "text-brand-teal", "text-success"][passwordStrength];
return (
    <form onSubmit={submit} className={cn("grid gap-4", className)}>
      <div className="flex items-center gap-2 text-xs font-semibold text-ink/90 uppercase tracking-wider mb-2">
        <User className="h-4 w-4" />
        <span>Join as {role === "driver" ? "Driver" : "Passenger"}</span>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
          <input
            className="input pl-10"
            type="text"
            autoComplete="name"
            value={form.full_name}
            onChange={(e) => setField("full_name", e.target.value)}
            placeholder="Asha Kumar"
            required
          />
          {fieldErrors.full_name && <p className="mt-1 text-[10px] text-danger">{fieldErrors.full_name}</p>}
        </div>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
          <input
            className="input pl-10"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder="you@example.com"
            required
          />
          {fieldErrors.email && <p className="mt-1 text-[10px] text-danger">{fieldErrors.email}</p>}
        </div>
        <div className="relative md:col-span-2">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
          <input
            className="input pl-10"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            placeholder="+919876543210"
            required
          />
          {fieldErrors.phone && <p className="mt-1 text-[10px] text-danger">{fieldErrors.phone}</p>}
        </div>
        <div className="relative md:col-span-2">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
          <input
            className="input pl-10 pr-10"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => {
              setField("password", e.target.value);
              setPasswordStrength(passwordStrengthMeter(e.target.value));
            }}
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
          {fieldErrors.password && <p className="mt-1 text-[10px] text-danger">{fieldErrors.password}</p>}
          <div className="flex items-center gap-1 mt-1">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={cn("h-1 w-4 rounded-sm transition-colors", i <= passwordStrength ? strengthColor : "bg-muted/30")} />
            ))}
            <span className="ml-2 text-[10px] text-muted">{passwordStrength ? strengthLabel : "Enter a password"}</span>
          </div>
        </div>
        <div className="relative md:col-span-2">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
          <input
            className="input pl-10 pr-10"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            value={form.confirm_password}
            onChange={(e) => setField("confirm_password", e.target.value)}
            placeholder="••••••••"
            required
          />
          <button
            type="button"
            onClick={() => setShowConfirm((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-brand transition-colors"
            aria-label={showConfirm ? "Hide confirm" : "Show confirm"}
          >
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          {fieldErrors.confirm_password && <p className="mt-1 text-[10px] text-danger">{fieldErrors.confirm_password}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          id="terms"
          type="checkbox"
          checked={terms}
          onChange={() => setTerms((t) => !t)}
          className="rounded border-brand-teal bg-surface text-brand-teal focus:ring-brand-teal"
          required
        />
        <label htmlFor="terms" className="text-sm text-muted cursor-pointer select-none">
          I agree to the <a href="/terms" className="text-brand-teal hover:underline">Terms of Service</a> and{" "}
          <a href="/privacy" className="text-brand-teal hover:underline">Privacy Policy</a>
        </label>
        {fieldErrors.terms && <p className="mt-1 text-[10px] text-danger">{fieldErrors.terms}</p>}
      </div>
      <Button variant="primary" size="md" disabled={busy || !terms} className="w-full">
        {busy ? "Creating account…" : "Create & verify phone →"}
      </Button>
      <p className="text-center text-sm text-muted">
        Have an account?{" "}
        <a href={`/login?role=${role}`} className="link-volt">
          Sign in
        </a>
      </p>
    </form>
  );
}