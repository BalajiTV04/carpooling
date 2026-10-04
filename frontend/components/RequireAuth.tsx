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

  if (!ready) return <p className="p-10 text-sm text-[#A5ABD6]">Checking session…</p>;
  if (!user) return null;
  if (roles && !roles.some((r) => user.roles.includes(r))) {
    return (
      <main className="mx-auto max-w-md px-5 py-16 text-center">
        <p className="font-display text-2xl font-bold">Not for your role</p>
        <p className="mt-2 text-sm text-[#A5ABD6]">
          This page needs role: {roles.join(" / ")}. You are: {user.roles.join(", ") || "none"}.
        </p>
        <a href="/" className="mt-6 inline-block rounded-full bg-volt-400 px-5 py-2 text-sm font-bold text-night-950">
          Back home
        </a>
      </main>
    );
  }
  return <>{children}</>;
}
