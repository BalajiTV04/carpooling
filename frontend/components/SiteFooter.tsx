import Link from "next/link";

/** Site footer for the landing page.
 *  Deliberately free of internal/developer detail (no module counts, test
 *  totals, API paths or hostnames) - it speaks to riders and drivers, and
 *  signals trust instead of stack details. */
const COLUMNS = [
  {
    heading: "Ride",
    links: [
      { label: "Find a ride", href: "/search" },
      { label: "Your bookings", href: "/requests" },
      { label: "Your impact", href: "/analytics" },
      { label: "Track live", href: "/search" }
    ]
  },
  {
    heading: "Drive",
    links: [
      { label: "Publish a trip", href: "/trips" },
      { label: "Your garage", href: "/garage" },
      { label: "Your profile", href: "/me" },
      { label: "Verify phone", href: "/verify" }
    ]
  },
  {
    heading: "Company",
    links: [
      { label: "Create account", href: "/register" },
      { label: "Log in", href: "/login" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Safety", href: "/#safety" }
    ]
  }
];

/** Trust points. Four short promises, no engineering jargon. */
const TRUST = [
  { icon: "🛡", title: "Verified drivers", desc: "Every car is checked before it can take passengers." },
  { icon: "🆘", title: "Live SOS", desc: "One tap alerts our safety team, in real time." },
  { icon: "📍", title: "Live tracking", desc: "See your trip and driver the whole way." },
  { icon: "₹", title: "Transparent fares", desc: "Know the split before you book. No surprises." }
];

export function SiteFooter() {
  return (
    <footer id="safety" className="relative overflow-hidden border-t border-[rgba(154,151,255,.15)] px-5 pt-14">
      {/* Faint glow so the footer still belongs to the same world. */}
      <div className="aurora aurora-b -left-20 -top-10 h-64 w-64 bg-iris-500/20" />

      {/* Trust row */}
      <div className="relative mx-auto grid max-w-7xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST.map((t) => (
          <div
            key={t.title}
            className="glass sheen rounded-2xl p-4 transition hover:border-volt-400/40"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-volt-400/25 bg-volt-400/10 text-base text-volt-300">
                {t.icon}
              </span>
              <div className="min-w-0">
                <p className="font-display text-sm font-bold">{t.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#A5ABD6]">{t.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Brand + link columns */}
      <div className="relative mx-auto mt-12 grid max-w-7xl gap-10 md:grid-cols-[1.3fr_2fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="pulse-dot grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-volt-400 to-volt-600 font-display text-base font-extrabold text-night-950 shadow-glow">
              V
            </span>
            <span className="leading-none">
              <span className="font-display block text-[15px] font-bold">VoltRide</span>
              <span className="block text-[10px] uppercase tracking-[.18em] text-[#5b6194]">
                route-aware sharing
              </span>
            </span>
          </div>
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-[#A5ABD6]">
            Share the ride, keep the route. We match you with drivers already
            heading your way, then meet at the point that costs them least.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="font-display text-[11px] font-bold uppercase tracking-[.18em] text-volt-300">
                {col.heading}
              </p>
              <ul className="mt-3 grid gap-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-[13px] text-[#A5ABD6] transition hover:text-volt-300"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative mx-auto mt-12 max-w-7xl border-t border-[rgba(154,151,255,.12)] py-6">
        <div className="flex flex-col items-center justify-between gap-3 text-xs text-[#5b6194] sm:flex-row">
          <p>&copy; {new Date().getFullYear()} VoltRide. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <span className="cursor-default transition hover:text-volt-300">Privacy</span>
            <span className="cursor-default transition hover:text-volt-300">Terms</span>
            <span className="cursor-default transition hover:text-volt-300">Support</span>
          </div>
        </div>
      </div>
    </footer>
  );
}