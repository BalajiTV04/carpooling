"use client";
// Route guard: redirects to /login?next=<path> when no session.
// `roles` optionally enforces driver/passenger/admin (403 card otherwise).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";

export function RequireAuth({
  children, roles
}: {
  children: React.ReactNode; roles?: ("driver" | "passenger" | "admin")[];
}) {
  const { user, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/login?next=" + encodeURIComponent(window.location.pathname));
  }, [ready, user, router]);

  if (!ready) return <p className="p-10 text-sm text-muted">Checking session…</p>;
  if (!user) return null;
  if (roles && !roles.some((r) => user.roles.includes(r))) {
    return (
      <main className="mx-auto max-w-md px-5 py-16 text-center">
        <div className="panel p-8">
          <p className="eyebrow">Access restricted</p>
          <p className="font-display mt-2 text-2xl font-bold">Not for your role</p>
          <div className="roadline mx-auto mt-4 w-2/3 rounded-full opacity-60" aria-hidden />
          <p className="mt-4 text-sm text-muted">
            This page needs role: {roles.join(" / ")}. You are: {user.roles.join(", ") || "none"}.
          </p>
          <a href="/" className="btn btn-primary mt-6">
            Back home
          </a>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
