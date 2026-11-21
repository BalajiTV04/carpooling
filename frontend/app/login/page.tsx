"use client";
// Login: phone + password → session saved → redirect to role dashboard (/driver or /passenger).
import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Car, UserCheck } from "lucide-react";
import { toDigits, isValidMobile10, formatDisplay, DEFAULT_COUNTRY_CODE } from "@/lib/phone";

type UserRole = "passenger" | "driver";

function LoginForm() {
  const { login, error } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const roleParam = searchParams.get("role")?.toLowerCase();

  const [role, setRole] = useState<UserRole>(
    roleParam === "driver" ? "driver" : "passenger"
  );
  const [form, setForm] = useState({ phone: "", password: "" });
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sync role state whenever the query parameter changes
  useEffect(() => {
    if (roleParam === "driver") {
      setRole("driver");
    } else {
      setRole("passenger");
    }
  }, [roleParam]);

  const handleRoleSelect = (selectedRole: UserRole) => {
    setRole(selectedRole);
    const params = new URLSearchParams(searchParams.toString());
    params.set("role", selectedRole);
    router.replace(`/login?${params.toString()}`, { scroll: false });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const digits = toDigits(form.phone);
      if (!isValidMobile10(digits)) {
        setPhoneError("Enter a valid 10-digit mobile number");
        return;
      }
      setPhoneError(null);
      await login(digits, form.password, role);
      // Determine redirection based on target or user role
      if (nextParam) {
        router.push(nextParam);
      } else if (role === "driver") {
        router.push("/driver");
      } else {
        router.push("/passenger");
      }
    } catch {
      /* context error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={role === "driver" ? "Driver Login" : "Passenger Login"}
      sub="Log in with your registered phone number."
    >
      <form onSubmit={submit} className="grid gap-4">
        {/* Role Selection Tabs: Passenger & Driver Only */}
        <div className="grid grid-cols-2 gap-2 mb-1" role="tablist" aria-label="Login Role">
          <button
            type="button"
            role="tab"
            aria-selected={role === "passenger"}
            onClick={() => handleRoleSelect("passenger")}
            className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-xs font-semibold transition ${
              role === "passenger"
                ? "border-brand-teal bg-brand-teal/15 text-brand-teal ring-1 ring-brand-teal"
                : "border-line bg-surface text-muted hover:border-brand-teal/30 hover:text-ink"
            }`}
          >
            <UserCheck className="h-4 w-4" />
            Passenger
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={role === "driver"}
            onClick={() => handleRoleSelect("driver")}
            className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-xs font-semibold transition ${
              role === "driver"
                ? "border-brand-teal bg-brand-teal/15 text-brand-teal ring-1 ring-brand-teal"
                : "border-line bg-surface text-muted hover:border-brand-teal/30 hover:text-ink"
            }`}
          >
            <Car className="h-4 w-4" />
            Driver
          </button>
        </div>

        <Field label="Mobile Number">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-medium">
              {DEFAULT_COUNTRY_CODE}
            </span>
            <input
              className={`${inputCls} pl-10`}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              name="phone"
              value={form.phone}
              onChange={(e) => {
                const raw = e.target.value;
                const digits = toDigits(raw);
                setForm({ ...form, phone: digits });
                setPhoneError(
                  digits && !isValidMobile10(digits)
                    ? "Enter a valid 10-digit mobile number"
                    : null
                );
              }}
              placeholder="9876543210"
              maxLength={10}
              required
            />
            {phoneError && (
              <p className="mt-1 text-[11px] text-danger" role="alert" aria-live="polite">
                {phoneError}
              </p>
            )}
          </div>
          <span className="mt-1 block text-[11px] text-muted">
            Log in with <b>{formatDisplay(form.phone) || "+91 XXXXXXXXXX"}</b>
          </span>
        </Field>

        <Field label="Password">
          <input
            className={inputCls}
            name="password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </Field>

        {error && <Alert variant="danger">{error}</Alert>}

        <Button
          variant="primary"
          size="md"
          disabled={busy || !!phoneError || !isValidMobile10(toDigits(form.phone))}
          className="w-full"
        >
          {busy
            ? "Checking…"
            : role === "driver"
            ? "Log in as Driver →"
            : "Log in as Passenger →"}
        </Button>

        <p className="text-center text-sm text-muted">
          New here?{" "}
          <Link href="/register" className="link-volt">
            Create account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center">
          <div className="loader mx-auto mb-2" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
