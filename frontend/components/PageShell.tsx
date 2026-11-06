import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Shared page frame for every inner (non-landing) route.
 *
 * Consistent 8px grid, one max-width, motion-revealed header, glass surface.
 * All inner pages now share identical alignment so the nav and content line up.
 */
export function PageShell({
  title,
  accent,
  subtitle,
  children,
  wide = false,
  eyebrow,
  actions,
  className,
}: {
  title: React.ReactNode;
  accent?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("relative mx-auto w-full pt-10 pb-20", className)}>
      <div className={cn("px-5", wide ? "max-w-7xl" : "max-w-6xl mx-auto")}>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-brand-teal transition hover:text-brand"
        >
          ← VoltRide
        </Link>

        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={cn(
            "relative mt-6 overflow-hidden p-0 rounded-2xl border border-line bg-card shadow-sm panel-head",
            className
          )}
        >
          <div className="absolute -inset-4 bg-gradient-indigo-teal/10 blur-[60px] -z-10" aria-hidden />
          <div className="relative flex flex-wrap items-end justify-between gap-4 p-6">
            <div className="min-w-0">
              {eyebrow ? (
                <p className="uppercase tracking-wider text-[10px] font-semibold text-brand-teal mb-2">
                  {eyebrow}
                </p>
              ) : null}
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
                {title}
                {accent ? <span className="text-brand-teal"> {accent}</span> : null}
              </h1>
              {subtitle ? (
                <p className="mt-2 text-sm text-muted leading-relaxed">{subtitle}</p>
              ) : null}
            </div>
            {actions ? (
              <div className="flex flex-wrap items-center gap-3">{actions}</div>
            ) : null}
          </div>
          <div className="h-[1px] bg-gradient-to-r from-transparent via-brand-teal/30 to-transparent mx-6" aria-hidden />
        </motion.header>

        {children}
      </div>
    </main>
  );
}