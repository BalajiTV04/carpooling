"use client";
// Signature index section: the real matching pipeline from services/matching.py.
// The order below is NOT decorative - it is the hard-gate order the code uses:
// safety, then feasibility, then cost, then the learned re-ranker.
//
// Copy is deliberately customer-facing: the rules stay in the code, but a
// visitor should read "we check X", not "module N scores Y".
const STAGES = [
  {
    key: "01",
    name: "Safety check",
    desc: "We look at safety signals and history before anything else.",
    hard: true
  },
  {
    key: "02",
    name: "Shared route",
    desc: "Your journey has to actually follow the driver's road.",
    hard: true
  },
  {
    key: "03",
    name: "Timing",
    desc: "You have to be going at roughly the same time.",
    hard: true
  },
  {
    key: "04",
    name: "Seats free",
    desc: "There has to be a seat left on the trip.",
    hard: true
  },
  {
    key: "05",
    name: "Shortest pickup",
    desc: "We pick the boarding point that costs the driver least.",
    hard: false
  },
  {
    key: "06",
    name: "Fair price",
    desc: "Your share is worked out for the part you ride.",
    hard: false
  },
  {
    key: "07",
    name: "Best of the rest",
    desc: "Smarter ordering of trips that already passed every check.",
    hard: false
  }
];

export function MatchPipeline() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {STAGES.map((s) => (
        <div
          key={s.key}
          className="glass group sheen relative rounded-2xl p-4 transition hover:border-volt-400/50"
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-xs font-bold text-iris-300">{s.key}</span>
            {s.hard ? (
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-300">
                must pass
              </span>
            ) : (
              <span className="rounded-full bg-volt-400/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-volt-300">
                fine-tune
              </span>
            )}
          </div>
          <p className="font-display mt-2 text-[15px] font-bold">{s.name}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#A5ABD6]">{s.desc}</p>
          <div
            className={`mt-3 h-0.5 rounded-full ${
              s.hard
                ? "bg-gradient-to-r from-rose-400/70 to-transparent"
                : "bg-gradient-to-r from-volt-400/70 to-transparent"
            }`}
          />
        </div>
      ))}

      <div className="glass rounded-2xl p-4 md:col-span-2 lg:col-span-1">
        <p className="font-display text-[15px] font-bold text-volt-300">Why it matters</p>
        <p className="mt-1 text-[11px] leading-relaxed text-[#A5ABD6]">
          The final step only reorders trips that already passed every check. It
          can never lift an unsafe, impractical or fully booked trip into your
          results.
        </p>
        <div className="mt-3 h-0.5 dash-walk rounded-full" />
      </div>
    </div>
  );
}