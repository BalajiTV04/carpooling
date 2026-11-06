// Reusable glass auth card wrapper — consistent look across login/register/verify.
import Link from "next/link";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

interface AuthCardProps {
  title: string;
  sub: string;
  backLink?: { href: string; label: string };
  children: React.ReactNode;
}

export function AuthCard({ title, sub, backLink, children }: AuthCardProps) {
  return (
    <main className="relative mx-auto max-w-md px-5 pb-24 pt-16">
      <div className="glow-brand -left-12 top-8 h-64 w-64 rounded-full mix-blend-screen" aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative"
      >
        {backLink && (
          <Link
            href={backLink.href}
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-teal transition hover:text-brand mb-4"
          >
            <span className="text-base leading-none">←</span> {backLink.label}
          </Link>
        )}
        <div className="mt-6 flex items-center gap-3">
          <BrandMark size={44} className="shadow-glow-brand" />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
              {title}
            </h1>
            <p className="mt-1 text-sm text-muted">{sub}</p>
          </div>
        </div>
        <div className="mt-6 h-[1px] bg-gradient-to-r from-transparent via-brand-teal/30 to-transparent" aria-hidden />
        <div className="mt-8">
          <div className="glass-card p-8">{children}</div>
        </div>
      </motion.div>
    </main>
  );
}