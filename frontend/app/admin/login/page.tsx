"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Shield } from "lucide-react";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";

export default function AdminLoginPage() {
  const { user, ready, login } = useSession();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (ready && user?.roles?.includes("admin")) router.replace("/admin/dashboard");
  }, [ready, user, router]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await login(String(form.get("name") ?? ""), String(form.get("password") ?? ""), "admin");
      router.replace("/admin/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return <div className="min-h-screen bg-bg" />;

  return <main className="flex min-h-screen items-center justify-center bg-bg p-4"><section className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-lg sm:p-8"><Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted transition hover:text-brand-teal"><ArrowLeft className="h-4 w-4" />Back to home</Link><div className="mb-7 flex items-center gap-3"><div className="rounded-xl bg-brand-teal/10 p-3 text-brand-teal"><Shield className="h-6 w-6" /></div><div><h1 className="font-display text-2xl font-bold text-ink">Admin login</h1><p className="mt-1 text-sm text-muted">Sign in to manage the VoltRide platform.</p></div></div><form onSubmit={handleLogin} className="space-y-4"><label className="block text-sm font-medium text-ink">Username<input name="name" type="text" className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-ink outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15" required /></label><label className="block text-sm font-medium text-ink">Password<input name="password" type="password" className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-ink outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15" required /></label>{error && <div className="flex gap-2 rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-danger"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}<Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Signing in…" : "Sign in to dashboard"}</Button></form></section></main>;
}
