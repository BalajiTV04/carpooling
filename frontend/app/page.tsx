"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Car, Shield, Clock, MapPin } from "lucide-react";
import { fetchHealth } from "@/lib/api";
import type { HealthResp } from "@/lib/api";
import { BrandMark } from "@/components/BrandMark";

export default function Home() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then((h) => setHealth(h))
      .catch((e) => setError(e?.message ?? "Backend unreachable"));
  }, []);

  return (
    <section className="relative isolate min-h-screen flex flex-col bg-token-bg text-token-ink overflow-hidden">
      {/* Ambient gradient mesh background */}
      <div className="absolute top-0 left-0 w-full h-full -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[60%] bg-brand/20 blur-[120px] rounded-full" aria-hidden />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[60%] bg-brand-teal/15 blur-[120px] rounded-full" aria-hidden />
        <div className="absolute top-[30%] left-[40%] w-[20%] h-[30%] bg-brand-amber/10 blur-[80px] rounded-full" aria-hidden />
      </div>

      {/* Subtle grid pattern */}
      <div className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] [background-size:40px_40px] [background-image:linear-gradient(to_right,rgb(var(--color-line))/0.3_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--color-line))/0.3_1px,transparent_1px)] [background-blend_mode:normal]" aria-hidden />

      <div className="mx-auto max-w-7xl px-5 flex-1">
        {/* Navbar spacer */}
        <div className="h-16" />

        {/* Hero */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center pt-20 pb-32">
          {/* Kicker */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-brand-teal/20 bg-brand-teal/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-teal mb-6 animate-pulse-soft"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand-teal animate-pulse-soft" />
            System live · {health?.db === "connected" ? "connected" : "standby"}
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="font-display text-6xl font-extrabold tracking-tight text-ink leading-[1.05] mb-6 md:text-7xl lg:text-8xl"
          >
            Share the ride,{" "}
            <span className="text-gradient-brand">keep the journey.</span>
          </motion.h1>

          {/* Subhead */}
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-0 text-xl text-ink-soft leading-relaxed max-w-2xl mx-auto mb-10 md:text-2xl"
          >
            Intelligent private vehicle sharing built around real routes, real
            seats, and real-time matching. Publish a trip, book a seat, and go.
          </motion.p>

          {/* Primary actions */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link
              href="/search"
              className="btn btn-primary btn-lg flex items-center gap-2"
            >
              Find a ride <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
            <Link href="/trips" className="btn btn-secondary btn-lg flex items-center gap-2">
              Become a driver <Car className="ml-1 h-4 w-4" />
            </Link>
            {health?.db === "connected" && (
              <Link
                href="/admin/login"
                className="btn btn-danger btn-lg flex items-center gap-2"
              >
                <Shield className="h-5 w-5" /> Login as Admin
              </Link>
            )}
          </motion.div>
        </div>
        {/* Feature grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-20"
        >
          <div className="grid gap-6 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 + i * 0.1 }}
                whileHover={{ y: -4 }}
                className="glass-card p-6"
              >
                <div className="h-12 w-12 rounded-2xl bg-surface flex items-center justify-center text-brand-teal mb-4">
                  {i === 1 && <Shield className="h-6 w-6" />}
                  {i === 2 && <Clock className="h-6 w-6" />}
                  {i === 3 && <MapPin className="h-6 w-6" />}
                </div>
                <h3 className="font-display text-lg font-bold text-ink mb-2">
                  {i === 1 ? "Verified drivers" : i === 2 ? "Real-time ETA" : "Smart matching"}
                </h3>
                <p className="text-sm text-muted leading-relaxed">
                  {i === 1
                    ? "Every driver is identity-verified and rated by the community."
                    : i === 2
                    ? "Live tracking keeps you informed from pickup to drop-off."
                    : "AI-powered route overlap finds the best ride for you."}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Stat band */}
        <div className="mt-16 border-t border-line pt-10">
          <div className="flex flex-wrap justify-center gap-8 md:gap-12 text-sm">
            <div className="text-center">
              <div className="text-2xl font-extrabold text-ink font-display">10k+</div>
              <div className="text-muted">Rides shared weekly</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-extrabold text-ink font-display">4.9★</div>
              <div className="text-muted">Avg. driver rating</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-extrabold text-ink font-display">50+</div>
              <div className="text-muted">Cities covered</div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating brand mark (bottom corner) */}
      <div className="absolute bottom-8 right-8 opacity-20 pointer-events-none">
        <BrandMark size={120} className="text-brand-teal/10" />
      </div>
    </section>
  );
}