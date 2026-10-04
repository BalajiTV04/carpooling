"use client";
// Landing page: the project's front door. Sections, top to bottom:
//   hero + animated vehicle · trust signals · matching pipeline · live map
//   · feature grid · roles · footer
// Everything is static/presentational except the health probe, so the page
// still renders fully when the backend is down.
//
// Customer-facing copy only: module counts, test totals, API route counts and
// stack names are intentionally NOT shown here.
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { RoleCard } from "@/components/RoleCard";
import { fetchHealth, type HealthResp } from "@/lib/api";
import { VehicleArt } from "@/components/VehicleArt";
import { LiveCorridorMap } from "@/components/LiveCorridorMap";
import { TrustSignals } from "@/components/TrustSignals";
import { MatchPipeline } from "@/components/MatchPipeline";
import { FeatureGrid } from "@/components/FeatureGrid";
import { SiteFooter } from "@/components/SiteFooter";

/** Reveal-on-scroll: adds `in` to any .reveal element once it is visible.
 *
 *  The `js-reveal` class on <html> is only added once this observer is
 *  actually installed, so the CSS can safely hide .reveal elements. If JS is
 *  blocked or slow, the class is never added and every section stays visible. */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (els.length === 0) return;
    document.documentElement.classList.add("js-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove("js-reveal");
    };
  }, []);
}

export default function Home() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((e) => setError(e?.message ?? "Backend unreachable"));
  }, []);

  useReveal();

  return (
    <main className="relative overflow-hidden">
      {/* ------ HERO --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
      <section className="relative isolate px-5 pb-16 pt-14">
        <div className="aurora aurora-a -left-24 -top-24 h-96 w-96 bg-iris-500/30" />
        <div className="aurora aurora-b -right-20 top-24 h-80 w-80 bg-volt-400/15" />
        <div className="grid-drift absolute inset-0 -z-10 opacity-40" />

        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-volt-400/30 bg-volt-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[.18em] text-volt-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt-400" />
              Route-aware · Shortest pickup · Always explained
            </span>

            <h1 className="font-display mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight md:text-6xl">
              <span className="text-gradient">Share the ride.</span>
              <br />
              <span className="text-iris-300">Keep the route.</span>
            </h1>

            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-[#A5ABD6]">
              Drivers publish trips, passengers match on real route overlap — not
              just city names. Every recommendation shows its working, from the
              safety gate all the way to your share of the fare.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/search"
                className="rounded-2xl bg-gradient-to-r from-volt-400 to-volt-500 px-6 py-3 font-display text-sm font-bold text-night-950 shadow-glow transition hover:brightness-110"
              >
                Find a ride →
              </Link>
              <Link
                href="/register"
                className="rounded-2xl border border-[rgba(154,151,255,.4)] px-6 py-3 font-display text-sm font-bold text-[#EEF0FF] transition hover:border-volt-400 hover:text-volt-300"
              >
                Become a driver
              </Link>
            </div>

            <div className="mt-7">
              <StatusPill health={health} error={error} />
            </div>
          </div>

          <VehicleArt />
        </div>
      </section>

      {/* ------ TRUST (customer-facing; replaces the old engineering counters) -------- */}
      <section className="reveal px-5 py-10">
        <div className="mx-auto max-w-7xl">
          <TrustSignals />
        </div>
      </section>

      {/* ------ PIPELINE --------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
      <section id="how-it-works" className="reveal px-5 py-14">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[.2em] text-volt-400">
              How a match is made
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              Seven checks before you see a ride
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#A5ABD6]">
              Safety always wins. Every candidate is put through the same checks
              in the same order, and only trips that clear all the hard ones are
              ever shown — smarter ranking can reorder them, never sneak an
              unsafe or impractical trip past.
            </p>
          </div>
          <div className="mt-8">
            <MatchPipeline />
          </div>
        </div>
      </section>

      {/* ------ LIVE MAP --------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
      <section className="reveal px-5 py-14">
        <div className="mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[.85fr_1.15fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-volt-400">
              The demo corridor
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              Real roads, not straight lines
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#A5ABD6]">
              Every trip follows the actual driving route, not a straight line on
              a map. We compare your journey against that real path, so a trip
              that genuinely crosses yours is a match - and one that merely
              starts in the same city is not.
            </p>
            <ul className="mt-5 grid gap-2 text-sm text-[#A5ABD6]">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-volt-400" />
                Match strength comes from the road you actually share
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-iris-400" />
                Pickup is checked every kilometre for the shortest detour
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-volt-400" />
                Find places by typing loosely, or tap them on the map
              </li>
            </ul>
          </div>
          <LiveCorridorMap />
        </div>
      </section>

      {/* ------ FEATURES --------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
      <section className="reveal px-5 py-14">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[.2em] text-volt-400">
              What you get
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              Built for the whole journey
            </h2>
          </div>
          <div className="mt-8">
            <FeatureGrid />
          </div>
        </div>
      </section>

      {/* ------ ROLES ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ */}
      <section className="reveal px-5 py-14">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[.2em] text-volt-400">
              Three ways in
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              Pick your seat
            </h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <RoleCard
              title="Driver console"
              desc="Publish your trip, fill the seats, share your location while driving, and get paid at the end."
              accent="volt"
              href="/trips"
              cta="Open console →"
            />
            <RoleCard
              title="Passenger app"
              desc="Search for rides, see why each one matches, choose your pickup point, book, and track the trip live."
              accent="iris"
              href="/search"
              cta="Find a ride →"
            />
            <RoleCard
              title="Safety team"
              desc="Our team watches live trips, handles emergency alerts, verifies every car, and moderates user accounts."
              accent="rose"
              href="/admin"
              cta="Admin only →"
            />
          </div>
        </div>
      </section>

      {/* ------ FOOTER -------- */}
      <SiteFooter />
    </main>
  );
}
