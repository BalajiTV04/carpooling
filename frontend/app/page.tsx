"use client";

// Landing page: the project's front door. Sections, top to bottom:
//   hero + brand + subtitle + how-it-works + features + footer
// Everything is static/presentational except the health probe, so the page
// still renders fully when the backend is down.
////
// Customer-facing copy only: counts and API route counts are intentionally
// not shown here — we keep the front door clean.
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SiteFooter } from "@/components/SiteFooter";

export default function Home() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((e) => setError(e?.message ?? "Backend unreachable"));
  }, []);

  const healthClass = health?.db === "connected" ? "pill-brand" : "pill-muted";
  const healthLabel = health?.db === "connected" ? "connected" : "offline";
<section className="relative isolate py-16 px-4 md:px-8">
  <div className="mx-auto max-w-7xl">
    <div className="text-center mb-10">
      <h1 className="font-display text-6xl font-extrabold text-brand leading-[1.1] md:text-7xl tracking-tight">
        VoltRide
      </h1>
      <p className="mt-3 text-2xl text-muted leading-relaxed md:text-3xl">
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
<section className="py-14 px-4 md:px-8 bg-token-surface">
  <div className="mx-auto max-w-7xl">
    <SectionHeader title="How It Works" subtitle="Three simple steps to share your ride">
      <div className="grid grid-cols-3 gap-6 mt-6">
        <div className="flex items-start justify-center text-center">
          <div className="w-14 h-14 rounded-xl bg-brand-teal/10 flex items-center justify-center mb-3">
            <svg className="h-7 w-7 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1={5} y1={19} x2={13} y2={5}></line>
              <line x1={12} y1={5} x2={19} y2={19}></line>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-ink">Post a Trip</h3>
          <p className="text-sm text-muted mt-1">Set your source, destination, date, and available seats.</p>
        </div>
        <div className="flex items-start justify-center text-center">
          <div className="w-14 h-14 rounded-xl bg-brand-teal/10 flex items-center justify-center mb-3">
            <svg className="h-7 w-7 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx={12} cy={12} r={10}></circle>
              <path d="M18 20l-7-5-7 5V10"></path>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-ink">Search Rides</h3>
          <p className="text-sm text-muted mt-1">Filter by route, date, seats, and trip type.</p>
        </div>
        <div className="flex items-start justify-center text-center">
          <div className="w-14 h-14 rounded-xl bg-brand-teal/10 flex items-center justify-center mb-3">
            <svg className="h-7 w-7 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx={12} cy={10} r={3}></circle>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-ink">Book & Track</h3>
          <p className="text-sm text-muted mt-1">Confirm your seat, share location live, and ride safely.</p>
        </div>
      </div>
    </SectionHeader>
  </div>
</section>
<section className="py-14 px-4 md:px-8 bg-token-bg">
  <div className="mx-auto max-w-7xl">
    <SectionHeader title="Built for the Whole Journey" subtitle="Trusted by commuters, verified by community">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
        <div className="card p-6 text-left">
          <div className="h-12 rounded-xl bg-brand-teal/10 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1={5} y1={19} x2={13} y2={5}></line>
              <line x1={12} y1={5} x2={19} y2={19}></line>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-ink mb-2">Intelligent Route Matching</h3>
          <p className="text-muted">Match passenger requests with compatible driver trips based on route overlap, pickup/dropoff feasibility, departure time, and seat availability.</p>
        </div>

        <div className="card p-6 text-left">
          <div className="h-12 rounded-xl bg-brand-teal/10 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx={12} cy={12} r={10}></circle>
              <path d="M18 20l-7-5-7 5V10"></path>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-ink">Minimum-Detour Pickup</h3>
          <p className="text-muted">Optimize the pickup point along the driver's route to minimize extra distance and walking for the passenger, with walk-to-point and door-departure strategies.</p>
        </div>

        <div className="card p-6 text-left">
          <div className="h-12 rounded-xl bg-brand-teal/10 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx={12} cy={10} r={3}></circle>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-ink">Dynamic Route-Segment Fare</h3>
          <p className="text-muted">Distance-based cost sharing across multiple passengers boarding/alighting at different points, with segment-level allocation and confirmed-fare preservation.</p>
        </div>

        <div className="card p-6 text-left">
          <div className="h-12 rounded-xl bg-brand-teal/10 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v2M12 22v2M17 5l-5 5-5-5M2 12l5 5 5-5M5 17l5 5 5-5"></path>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-ink">Emergency Assistance</h3>
          <p className="text-muted">SOS button for active rides — creates a critical alert visible to admins and drivers. Acknowledge and resolution flow with full audit records.</p>
        </div>
      </div>
    </SectionHeader>
  </div>
</section>
<section className="py-14 px-4 md:px-8 bg-token-surface">
  <div className="mx-auto max-w-7xl">
    <SectionHeader title="Pick Your Seat" subtitle="Three ways to ride with VoltRide">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <RoleCard title="Driver console" accent="volt" href="/trips" cta="Open console →">
          <p className="text-sm text-muted">Publish trips, manage vehicles, view bookings, track live locations, and earn from shared seats.</p>
        </RoleCard>
        <RoleCard title="Passenger app" accent="iris" href="/search" cta="Find a ride →">
          <p className="text-sm text-muted">Search for rides, view driver details and route matches, book a seat, track the trip live, and rate completed rides.</p>
        </RoleCard>
        <RoleCard title="Safety team" accent="rose" href="/admin" cta="Admin only →">
          <p className="text-sm text-muted">Verifies every car and driver, handles emergency alerts, moderates accounts, and maintains platform integrity.</p>
        </RoleCard>
      </div>
    </SectionHeader>
  </div>
</section>
<footer className="border-t border-line pt-14 pb-6 bg-token-surface">
  <div className="mx-auto max-w-7xl">
    <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-8">
      <div>
        <h3 className="font-display font-bold text-ink mb-3">VoltRide</h3>
        <p className="text-sm text-muted">Intelligent private vehicle sharing. Reduce your costs. Share your journey.</p>
      </div>
      <nav>
        <ul className="space-y-2 text-sm text-muted">
          <li><a href="/" className="hover:text-brand transition-colors">Home</a></li>
          <li><a href="/how-it-works" className="hover:text-brand transition-colors">How It Works</a></li>
          <li><a href="/search" className="hover:text-brand transition-colors">Find a Ride</a></li>
          <li><a href="/become-driver" className="hover:text-brand transition-colors">Become a Driver</a></li>
          <li><a href="/about" className="hover:text-brand transition-colors">About</a></li>
          <li><a href="/contact" className="hover:text-brand transition-colors">Contact</a></li>
        </ul>
      </nav>
      <div>
        <h4 className="font-semibold text-ink mb-3">Platform</h4>
        <ul className="space-y-1 text-sm text-muted">
          <li>Privacy & Safety</li>
          <li>Terms of Use</li>
          <li>Privacy Policy</li>
        </ul>
      </div>
      <div>
        <h4 className="font-semibold text-ink mb-3">Get Support</h4>
        <ul className="space-y-1 text-sm text-muted">
          <li>Help Center</li>
          <li>Safety Guidelines</li>
          <li>Contact Us</li>
        </ul>
      </div>
    </div>
    <div className="pt-4 border-t border-line flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted">
      <span>2026 VoltRide — Intelligent Private Vehicle Sharing</span>
      <div>
        <a href="#" className="hover:text-brand transition-colors mr-3">Terms</a>
        <a href="#" className="hover:text-brand transition-colors">Privacy</a>
      </div>
    </div>
  </div>
</footer>
