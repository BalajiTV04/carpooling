"use client";
// Top nav: brand + session-aware, ROLE-aware, PAGE-aware links.
// 
// Why a config array instead of hand-written JSX: the old bar rendered the
// SAME list for everyone, so a logged-out visitor on the landing page saw
// "Find ride / Requests / Impact / Data map" — four links that all bounce to
// /login — while a driver had NO link to their own /garage. One table now
// declares who sees what, and the current route is highlighted.
//
//   logged out -> Log in / Join only (no feature links anywhere)
//   passenger  -> ride-side links
//   driver     -> + trips + garage        (roles are additive)
//   admin      -> + console + data map
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { NotificationBell } from "@/components/NotificationBell";
import { BrandMark } from "@/components/BrandMark";

type Role = "driver" | "passenger" | "admin";
type NavItem = { href: string; label: string; roles?: Role[] };

/** Ordered left→right. `roles` = who may see it; omitted = any signed-in user.
 *  A user may hold several roles, so they see the UNION of every match.
 */
const LINKS: NavItem[] = [
  { href: "/search", label: "Find ride" },
  { href: "/trips", label: "My trips", roles: ["driver"] },
  { href: "/garage", label: "Garage", roles: ["driver"] },
  { href: "/requests", label: "Requests" },
  { href: "/analytics", label: "Impact" },
  { href: "/admin", label: "Console", roles: ["admin"] },
  // Data map ships an "Initialise DB" button — dev-only, so admin-only.
  { href: "/database", label: "Data map", roles: ["admin"] },
];

/** "You are here" cue — the bar previously gave none. */
const ACTIVE = "rounded-full border border-brand-teal/40 bg-brand-teal/15 px-3 py-1.5 font-semibold text-brand shadow-sm";

export function NavBar() {
  const { user, ready, logout } = useSession();
  const pathname = usePathname();

  // Logged out -> nothing renders here at all. Every one of these pages is
  // behind RequireAuth, so showing them only sends people to a login wall.
  const visible = LINKS.filter(
    (l) =>
      !!user &&
      (!l.roles || l.roles.some((r) => (user?.roles ?? []).includes(r)))
  );

  return (
    <nav className="sticky top-0 z-50 border-b border-brand-teal/10 bg-surface/80 backdrop-blur-xl">
      {/* Volt line: a 2px gradient rule that ties the bar to the hero route. */}
      <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-brand-teal/20 to-transparent" />
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="transition-transform duration-200 group-hover:-translate-y-0.5">
            <BrandMark size={36} />
          </span>
          <span className="leading-none">
            <span className="font-display block text-[15px] font-bold tracking-tight">
              VoltRide
            </span>
            <span className="block mt-1 text-[10px] uppercase tracking-[.18em] text-muted transition-colors group-hover:text-brand">
              route-aware sharing
            </span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-1 text-sm">
          {visible.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={pathname === l.href ? "page" : undefined}
              className={pathname === l.href ? ACTIVE : "text-muted hover:text-brand transition-colors"}
            >
              {l.label}
            </Link>
          ))}
          {/* Module 23: unread bell, only for a live session. */}
          {user && <NotificationBell enabled={!!user} />}
          {!ready ? (
            <span className="px-2 text-xs text-muted">…</span>
          ) : user ? (
            <>
              {!user.phone_verified && (
                <Link href="/verify" className="rounded-full border border-brand-teal/60 px-3 py-1.5 text-brand transition hover:bg-brand-teal/10">
                  Verify
                </Link>
              )}
              <Link href="/me" className="rounded-full bg-brand px-3 py-1.5 text-white transition hover:bg-brand/90">
                {user.full_name || user.phone}
              </Link>
              <button
                onClick={() => {
                  logout(); window.location.href = "/";
                }}
                className="rounded-full px-3 py-1.5 text-muted transition hover:text-brand"
              >
                Out
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 text-sm">
                <Link
                  href="/login?role=driver"
                  className="rounded-full border border-brand-teal/60 px-3 py-1.5 text-brand transition hover:bg-brand-teal/10"
                  title="Driver login"
                >
                  Driver login
                </Link>
                <Link
                  href="/login?role=passenger"
                  className="rounded-full border border-brand-teal/60 px-3 py-1.5 text-brand transition hover:bg-brand-teal/10"
                  title="Passenger login"
                >
                  Passenger login
                </Link>
                <Link
                  href="/login?role=admin"
                  className="rounded-full border border-brand-teal/60 px-3 py-1.5 text-brand transition hover:bg-brand-teal/10"
                  title="Admin login"
                >
                  Admin login
                </Link>
              </div>
              <div className="px-2 text-[10px] text-muted">·</div>
              <span className="text-xs text-muted">New here?</span>{" "}
              <Link href="/register" className="text-xs underline underline-offset-2 hover:text-brand transition-colors">
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}