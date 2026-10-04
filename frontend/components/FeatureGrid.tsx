// Index feature grid: one card per module family, each with its accent tone.
// Cards lift on hover and keep the iris -> volt accent used across the app.
type Accent = "volt" | "iris" | "rose";

const FEATURES: {
  icon: string;
  title: string;
  desc: string;
  accent: Accent;
}[] = [
  {
    icon: "🧭",
    title: "Minimum-detour pickup",
    desc: "Scans every km of the driver's route to find the board point that costs the least extra distance — walk or door-to-door.",
    accent: "volt"
  },
  {
    icon: "🔍",
    title: "Explainable AI ranking",
    desc: "Route overlap, pickup closeness, drop-off and time are shown as factor bars, so you always see why a ride was recommended.",
    accent: "iris"
  },
  {
    icon: "📍",
    title: "Live tracking + trail",
    desc: "Watch your driver move along the route in real time, with automatic alerts if the trip goes off-course or the driver stops moving.",
    accent: "volt"
  },
  {
    icon: "🛡️",
    title: "Safety & SOS",
    desc: "One tap sends an emergency alert with your live location. Over-speed and off-route driving are flagged to our safety team automatically.",
    accent: "rose"
  },
  {
    icon: "🧾",
    title: "Per-leg fare split",
    desc: "You pay only for the parts of the journey you actually ride. The split is shown before you book and never changes afterwards.",
    accent: "iris"
  },
  {
    icon: "🌱",
    title: "Impact you can see",
    desc: "See the kilometres, fuel and CO2 saved versus driving alone - plus any trip where sharing would not have been worth it.",
    accent: "volt"
  }
];

const TONES: Record<Accent, { ring: string; chip: string; text: string }> = {
  volt: {
    ring: "hover:border-volt-400/60 hover:shadow-glow",
    chip: "bg-volt-400/15 text-volt-300 border-volt-400/30",
    text: "text-volt-300"
  },
  iris: {
    ring: "hover:border-iris-400/60 hover:shadow-card",
    chip: "bg-iris-500/15 text-iris-300 border-iris-400/30",
    text: "text-iris-300"
  },
  rose: {
    ring: "hover:border-rose-400/60 hover:shadow-card",
    chip: "bg-rose-500/15 text-rose-300 border-rose-400/30",
    text: "text-rose-300"
  }
};

export function FeatureGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((f) => {
        const t = TONES[f.accent];
        return (
          <div
            key={f.title}
            className={`glass sheen group rounded-xl3 p-5 transition ${t.ring}`}
          >
            <span className={`inline-block rounded-xl border px-3 py-1.5 text-base ${t.chip}`}>
              {f.icon}
            </span>
            <p className="font-display mt-3 text-base font-bold">{f.title}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#A5ABD6]">{f.desc}</p>
            <div
              className={`mt-4 h-0.5 w-10 rounded-full transition-all duration-300 group-hover:w-20 ${
                f.accent === "rose"
                  ? "bg-rose-400"
                  : f.accent === "iris"
                    ? "bg-iris-400"
                    : "bg-volt-400"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}