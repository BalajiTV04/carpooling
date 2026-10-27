"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SiteFooter } from "@/components/SiteFooter";
import type { HealthResp } from "@/lib/api";
import { fetchHealth } from "@/lib/api";

export default function Home() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then((health) => setHealth(health))
      .catch((e) => setError(e?.message ?? "Backend unreachable"));
  }, []);
  const healthClass = health?.db === "connected" ? "pill-brand" : "pill-muted";
  const healthLabel = health?.db === "connected" ? "connected" : "offline";
  return (<section className="relative isolate py-16 px-4 md:px-8">
    <div className="mx-auto max-w-7xl">
      <div className="text-center mb-10">
        <h1 className="font-display text-6xl font-extrabold text-brand leading-[1.1] md:text-7xl tracking-tight">
          VoltRide
        </h1>
        <p className="mt-6 text-2xl text-muted leading-relaxed md:text-3xl">
          Intelligent Private Vehicle Sharing
        </p>
      </div>
      <div className="mt-8 flex gap-4 justify-center flex-wrap">
        <Link href="/trips" className="btn btn-primary btn-lg px-8 py-3 text-base" title="Open driver console">
          Become a Driver
        </Link>
        <Link href="/search" className="btn btn-secondary btn-lg px-8 py-3 text-base" title="Find a ride">
          Find a Ride
        </Link>
      </div>
    </div>
  </section>
  );
}
