// Shared auth form shell: branded night card + error slot.
//
// The old shell was a bare heading over a plain box. Auth pages are the first
// thing a new rider sees, so this now carries the same route motif used on the
// landing page: a brand mark, a road rule under the heading, and the raised
// panel surface from the design system.
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="relative mx-auto max-w-md px-5 pb-20 pt-12">
      {/* Soft glow so the auth card sits in the same lit world as the landing page. */}
      <div className="glow-iris -left-10 top-6 h-56 w-56 bg-accent/25" aria-hidden />

      <div className="relative">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-teal transition hover:text-brand-teal">
          <span className="text-base leading-none">←</span> VoltRide
        </Link>

        <div className="mt-4 flex items-center gap-3">
          <BrandMark size={42} />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">{title}</h1>
            <p className="mt-0.5 text-sm text-muted">{sub}</p>
          </div>
        </div>

        {/* Route rule: ties the form to the product's road motif. */}
        <div className="roadline mt-4 rounded-full opacity-70" aria-hidden />

        <div className="panel mt-5 p-6">{children}</div>
      </div>
    </main>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

// Single source for the field look. Points at the design-system `.input` class
// so every form in the app picks up the same focus ring, border and padding;
// pages that need extra modifiers simply append to this string.
export const inputCls = "input";
