"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { NotificationBell } from "@/components/NotificationBell";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, X } from "lucide-react";

type Role = "driver" | "passenger" | "admin";
type NavItem = { href: string; label: string; roles?: Role[] };

const LINKS: NavItem[] = [
  { href: "/passenger", label: "Rider Console", roles: ["passenger"] },
  { href: "/driver", label: "Driver Console", roles: ["driver"] },
  { href: "/search", label: "Find ride" },
  { href: "/trips", label: "My trips", roles: ["driver"] },
  { href: "/garage", label: "Garage", roles: ["driver"] },
  { href: "/requests", label: "Requests" },
  { href: "/analytics", label: "Impact" },
  { href: "/admin", label: "Console", roles: ["admin"] },
  { href: "/database", label: "Data map", roles: ["admin"] },
];

function cnNav(...classes: (string | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

// Helper to check if user has required role
const hasRole = (user: any, roles: Role[]) => {
  if (!user || !user.roles) return false;
  return roles.some((r) => user.roles.includes(r));
};

export function NavBar() {
  const { user, ready, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const visible = React.useMemo(
    () =>
      LINKS.filter(
        (l) =>
          !!user &&
          (!l.roles || hasRole(user, l.roles))
      ),
    [user]
  );

  const handleLogout = () => {
    logout();
    router.push("/");
    setMobileOpen(false);
  };

  if (pathname.startsWith("/admin") || pathname.startsWith("/driver") || pathname.startsWith("/passenger")) return null;

  return (
    <>
      {/* Desktop nav */}
      <nav className="sticky top-0 z-50 border-b border-line/50 bg-surface/80 backdrop-blur-xl">
        <div className="absolute inset-x-0 -bottom-[1px] h-[1px] bg-gradient-to-r from-transparent via-brand-teal/20 to-transparent" />
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <Link href="/" className="group flex items-center gap-3">
            <BrandMark size={34} className="transition-transform duration-300 group-hover:scale-105" />
            <div className="leading-none">
              <span className="font-display block text-[16px] font-bold tracking-tight text-ink">
                VoltRide
              </span>
              <span className="block mt-1 text-[10px] uppercase tracking-[.2em] text-muted transition-colors group-hover:text-brand-teal">
                route-aware sharing
              </span>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-2 text-sm">
            {visible.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={cnNav(
                  "px-3 py-2 rounded-xl font-medium transition-colors",
                  pathname === l.href
                    ? "bg-gradient-indigo-teal text-white shadow-sm shadow-glow-brand"
                    : "text-muted hover:text-brand-teal hover:bg-surface/50"
                )}
              >
                {l.label}
              </Link>
            ))}
            {user && <NotificationBell enabled={!!user} />}
            {!ready ? (
              <span className="px-2 text-xs text-muted">…</span>
            ) : user ? (
              <>
                {!user.phone_verified && (
                  <Link
                    href="/verify"
                    className="rounded-full border border-brand-teal/30 px-3 py-1.5 text-brand-teal transition hover:bg-brand-teal/10"
                  >
                    Verify
                  </Link>
                )}
                <Link
                  href="/me"
                  className="rounded-full bg-gradient-indigo-teal px-3 py-1.5 text-white shadow-sm shadow-glow-brand transition hover:shadow-glow-brand/80"
                >
                  {user.full_name || user.phone}
                </Link>
                <button
                  onClick={handleLogout}
                  className="rounded-full px-3 py-1.5 text-muted transition hover:text-danger hover:bg-surface/50 flex items-center gap-1"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden md:inline">Logout</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login?role=driver"
                  className="rounded-full border border-brand-teal/30 px-3 py-1.5 text-brand-teal transition hover:bg-brand-teal/10"
                  title="Driver login"
                >
                  Driver
                </Link>
                <Link
                  href="/login?role=passenger"
                  className="rounded-full border border-brand-teal/30 px-3 py-1.5 text-brand-teal transition hover:bg-brand-teal/10"
                  title="Passenger login"
                >
                  Rider
                </Link>
                <div className="px-1 text-xs text-muted">·</div>
                <Link
                  href="/register"
                  className="rounded-full bg-gradient-indigo-teal px-3 py-1.5 text-white shadow-sm shadow-glow-brand transition hover:shadow-glow-brand/80"
                >
                  Join
                </Link>
              </>
            )}
          </div>

          <div className="md:hidden">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg text-muted hover:text-brand-teal hover:bg-surface/50 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </nav>
    {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, x: "100%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-[60] flex flex-col lg:hidden"
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            {/* Drawer panel */}
            <motion.div
              initial={{ opacity: 0, x: "100%" }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="absolute top-0 right-0 h-full w-full max-w-xs bg-card border-l border-line shadow-lg flex flex-col"
            >
              <div className="px-5 py-4 flex items-center justify-between border-b border-line">
                <Link href="/" className="flex items-center gap-2">
                  <BrandMark size={30} />
                  <span className="font-display block text-[15px] font-bold tracking-tight text-ink">
                    VoltRide
                  </span>
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-lg text-muted hover:text-brand-teal hover:bg-surface/50 transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-5 px-5 space-y-1">
                {visible.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMobileOpen(false)}
                    className={cnNav(
                      "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                      pathname === l.href
                        ? "bg-gradient-indigo-teal text-white shadow-sm"
                        : "text-ink/90 hover:bg-surface/50 hover:text-brand-teal"
                    )}
                  >
                    {l.label}
                  </Link>
                ))}
                <div className="mt-6 pt-6 border-t border-line space-y-2">
                  {user ? (
                    <>
                      {!user.phone_verified && (
                        <Link
                          href="/verify"
                          className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium border border-brand-teal/30 text-brand-teal hover:bg-brand-teal/5"
                        >
                          Verify
                        </Link>
                      )}
                      <Link
                        href="/me"
                        className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium bg-gradient-indigo-teal text-white shadow-sm"
                      >
                        {user.full_name || user.phone}
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-muted hover:text-danger hover:bg-surface/50 transition-colors"
                      >
                        Sign out
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login?role=driver"
                        className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium border border-brand-teal/30 text-brand-teal hover:bg-brand-teal/5"
                      >
                        Driver login
                      </Link>
                      <Link
                        href="/login?role=passenger"
                        className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium border border-brand-teal/30 text-brand-teal hover:bg-brand-teal/5"
                      >
                        Rider login
                      </Link>
                      <Link
                        href="/register"
                        className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium bg-gradient-indigo-teal text-white shadow-sm"
                      >
                        Create account
                      </Link>
                      <ThemeToggle />
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}