"use client";
// Login: phone + password → session saved → redirect to role dashboard (/driver or /passenger).
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { AuthShell, Field, inputCls } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Car, UserCheck } from "lucide-react";

function LoginForm() {
  const { login, error } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const roleParam = searchParams.get("role");

  const [role, setRole] = useState<"driver" | "passenger" | null>(
    roleParam === "driver" ? "driver" : roleParam === "passenger" ? "passenger" : null
  );
  const [form, setForm] = useState({ phone: "", password: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(form.phone, form.password, role || undefined);
      // Determine redirection based on target or user role
      if (nextParam) {
        router.push(nextParam);
      } else if (role === "driver") {
        router.push("/driver");
      } else if (role === "passenger") {
        router.push("/passenger");
      } else {
        // Read stored session to direct appropriately
        const stored = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("voltride_user") || "{}") : {};
        if (stored?.roles?.includes("admin")) {
          router.push("/admin/dashboard");
        } else if (stored?.roles?.includes("driver")) {
          router.push("/driver");
        } else {
          router.push("/passenger");
        }
      }
    } catch {
      /* context error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={role === "driver" ? "Driver Login" : role === "passenger" ? "Passenger Login" : "Welcome Back"}
      sub="Log in with your registered phone number."
    >
      <form onSubmit={submit} className="grid gap-4">
        {/* Optional Role Filter Buttons */}
        <div className="grid grid-cols-2 gap-2 mb-1">
          <button
            type="button"
            onClick={() => setRole(role === "passenger" ? null : "passenger")}
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
            onClick={() => setRole(role === "driver" ? null : "driver")}
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

        <Field label="Phone">
          <input
            className={inputCls}
            name="phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+919876543210"
            required
          />
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

        <Button variant="primary" size="md" disabled={busy} className="w-full">
          {busy ? "Checking…" : `Log in as ${role === "driver" ? "Driver" : role === "passenger" ? "Passenger" : "User"} →`}
        </Button>

        <p className="text-center text-sm text-muted">
          New here?{" "}
          <a href="/register" className="link-volt">
            Create account
          </a>
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
