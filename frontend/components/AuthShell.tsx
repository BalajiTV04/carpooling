import Link from "next/link";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

/**
 * Shared auth form shell: glass card + motion reveal.
 * First thing a new rider sees — carries the same route motif as the landing
 * page but in a raised glass container with staggered entrance animation.
 */
export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="relative mx-auto max-w-md px-5 pb-24 pt-16">
      {/* Ambient glow behind the auth card */}
      <div className="glow-brand -left-12 top-8 h-64 w-64 rounded-full mix-blend-screen" aria-hidden />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative"
      >
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-brand-teal transition hover:text-brand"
        >
          <span className="text-base leading-none">←</span> VoltRide
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <BrandMark size={44} className="shadow-glow-brand" />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
              {title}
            </h1>
            <p className="mt-1 text-sm text-muted">{sub}</p>
          </div>
        </div>

        {/* Decorative divider */}
        <div className="mt-6 h-[1px] bg-gradient-to-r from-transparent via-brand-teal/30 to-transparent" aria-hidden />

        <div className="mt-8">
          <div className="glass-card p-8">{children}</div>
        </div>
      </motion.div>
    </main>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-ink/90 uppercase tracking-wider mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Single source for the field look. Points at the design-system `.input` class */
export const inputCls = "input";