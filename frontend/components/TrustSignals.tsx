"use client";
// Trust signals for the index page.
//
// This row deliberately REPLACED the old engineering counters (module count,
// passing tests, API route count, collection count, model AUC). Those numbers
// describe the build, not the product, so they read as developer metadata to
// anyone visiting the site. Each card below is a benefit a rider or driver
// actually cares about, animated on scroll via the shared .reveal mechanism.
const SIGNALS = [
  {
    icon: "🛡",
    title: "Safety first, always",
    desc: "Over-speed, route deviation and one-tap SOS are monitored on every trip - not just advertised."
  },
  {
    icon: "✅",
    title: "Verified drivers",
    desc: "A car is checked by our team before it can carry a single passenger."
  },
  {
    icon: "📍",
    title: "Tracked live",
    desc: "Watch your driver and the route in real time from pickup to drop-off."
  },
  {
    icon: "⚖️",
    title: "Fair, fixed fares",
    desc: "You see exactly what you pay for each leg before you confirm the booking."
  }
];

export function TrustSignals() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {SIGNALS.map((s) => (
        <div
          key={s.title}
          className="glass sheen group rounded-2xl p-4 transition hover:border-volt-400/50"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-volt-400/25 bg-volt-400/10 text-lg transition group-hover:scale-105">
            {s.icon}
          </span>
          <p className="font-display mt-3 text-sm font-bold">{s.title}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#A5ABD6]">{s.desc}</p>
        </div>
      ))}
    </div>
  );
}