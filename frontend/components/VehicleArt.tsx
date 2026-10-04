"use client";
// Animated vehicle art for the landing hero.
//
// Why hand-built SVG instead of an image or icon library: the project ships
// three runtime deps and no asset pipeline. Everything here is vector shapes
// animated with CSS, so it stays crisp at any size, costs no network request,
// and respects prefers-reduced-motion (see globals.css).
//
// The scene tells the product story: a car travelling a road, a pickup pin
// dropping onto the route, and a passenger fading in to board.
export function VehicleArt() {
  // Far skyline, back-to-front. Static data, no state needed.
  const SKYLINE = [
    [10, 120, 26, 90], [44, 150, 22, 60], [74, 96, 30, 114], [112, 168, 20, 42],
    [140, 110, 26, 100], [174, 158, 24, 52], [206, 88, 28, 122], [242, 156, 22, 54],
    [272, 124, 26, 86], [306, 166, 20, 44], [334, 104, 28, 106], [370, 152, 24, 58],
    [402, 130, 26, 80]
  ];

  return (
    <div className="map-glow relative min-h-[430px] overflow-hidden rounded-xl3 border border-[rgba(154,151,255,.25)] bg-night-900/70">
      {/* Scenery */}
      <div className="grid-drift absolute inset-0 opacity-40" />
      <div className="aurora aurora-a -left-14 top-4 h-52 w-52 bg-iris-500/35" />
      <div className="aurora aurora-b -right-6 bottom-16 h-44 w-44 bg-volt-400/20" />

      {/* Far skyline: parallax depth */}
      <svg viewBox="0 0 460 340" className="absolute inset-x-0 bottom-0 h-[62%] w-full opacity-40">
        {SKYLINE.map(([x, y, w, h], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx="3"
            fill="#1A2154"
            stroke="rgba(154,151,255,.35)"
          />
        ))}
      </svg>

      {/* Road */}
      <div className="absolute inset-x-0 bottom-0 h-[26%]">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-night-900 to-night-950" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 border-t border-[rgba(154,151,255,.18)] bg-night-950/70" />
        {/* Centre line: dashes scroll right to sell forward motion */}
        <div className="road-dash absolute bottom-3 left-0 h-0.5 w-full" />
      </div>

      {/* Speed streaks */}
      <div className="absolute inset-x-0 bottom-[10%] h-[14%]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="streak absolute h-[2px] w-1/3 rounded-full bg-gradient-to-r from-transparent via-volt-400/60 to-transparent"
            style={{ top: `${i * 22 + 6}%`, animationDelay: `${i * 0.45}s` }}
          />
        ))}
      </div>

      {/* The car */}
      <div className="car-bob absolute bottom-[16%] left-1/2 -translate-x-1/2">
        <svg viewBox="0 0 300 150" className="w-[290px] drop-shadow-[0_18px_28px_rgba(0,0,0,.55)] sm:w-[340px]">
          <defs>
            <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D8FF7A" />
              <stop offset="45%" stopColor="#C6FF4A" />
              <stop offset="100%" stopColor="#8BC81A" />
            </linearGradient>
            <linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9A97FF" />
              <stop offset="100%" stopColor="#2A3272" />
            </linearGradient>
            <linearGradient id="beamGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(216,255,122,.55)" />
              <stop offset="100%" stopColor="rgba(216,255,122,0)" />
            </linearGradient>
          </defs>

          {/* Headlight beam */}
          <path d="M262 84 L330 66 L330 106 L262 92 Z" fill="url(#beamGrad)" />

          {/* Body */}
          <path
            d="M26 96 C26 80, 40 72, 62 70 L92 40 C100 34, 110 31, 124 31 L186 31
               C200 31, 210 35, 218 44 L244 68 C262 72, 272 80, 272 96 L272 104
               C272 110, 268 113, 262 113 L36 113 C30 113, 26 110, 26 104 Z"
            fill="url(#bodyGrad)"
          />
          {/* Lower shade */}
          <path
            d="M26 100 L272 100 L272 104 C272 110, 268 113, 262 113 L36 113
               C30 113, 26 110, 26 104 Z"
            fill="#070A1A"
            opacity="0.35"
          />
          {/* Canopy */}
          <path
            d="M100 68 L118 42 C122 37, 128 34, 136 34 L180 34 C190 34, 197 37, 202 44
               L222 68 Z"
            fill="url(#glassGrad)"
            opacity="0.92"
          />
          {/* Belt line + door handle */}
          <path d="M92 72 L226 72" stroke="#070A1A" strokeWidth="2" opacity="0.25" />
          <rect x="164" y="80" width="16" height="4" rx="2" fill="#070A1A" opacity="0.35" />

          {/* Headlight + tail light */}
          <ellipse cx="266" cy="86" rx="9" ry="6" fill="#EEF0FF" />
          <ellipse cx="266" cy="86" rx="4" ry="3" fill="#C6FF4A" />
          <rect x="24" y="82" width="8" height="9" rx="2" fill="#F2545B" />

          {/* Wheels: tyre, rim, then spinning spokes */}
          {[92, 214].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="112" r="25" fill="#070A1A" />
              <circle cx={cx} cy="112" r="16" fill="#1A2154" stroke="#3A4388" strokeWidth="2" />
              <g className="wheel-spin" style={{ transformOrigin: `${cx}px 112px` }}>
                <path
                  d={`M${cx} 100 L${cx} 124`}
                  stroke="#9A97FF"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d={`M${cx - 12} 112 L${cx + 12} 112`}
                  stroke="#9A97FF"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </g>
              <circle cx={cx} cy="112" r="5" fill="#C6FF4A" />
            </g>
          ))}
        </svg>
      </div>

      {/* Pickup pin dropping onto the route, then a passenger boarding */}
      <div className="pin-drop absolute bottom-[42%] left-[16%]">
        <svg viewBox="0 0 40 52" className="w-7 drop-shadow-[0_0_14px_rgba(198,255,74,.75)]">
          <path
            d="M20 51 C20 51, 38 30, 38 19 A18 18 0 1 0 2 19 C2 30, 20 51, 20 51 Z"
            fill="#C6FF4A"
            stroke="#070A1A"
            strokeWidth="2.5"
          />
          <circle cx="20" cy="19" r="7" fill="#070A1A" />
        </svg>
      </div>

      <div className="passenger-pop absolute bottom-[30%] left-[27%] flex items-center gap-1.5 rounded-full border border-volt-400/40 bg-night-950/85 px-2.5 py-1 text-[10px] font-bold text-volt-300 backdrop-blur">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-volt-400 text-[9px] font-black text-night-950">
          P
        </span>
        boarding
      </div>

      {/* Status chips */}
      <div className="absolute left-4 top-4 rounded-full border border-volt-400/30 bg-night-950/80 px-3 py-1 text-[11px] font-semibold text-volt-300 backdrop-blur">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-volt-400 align-middle" />
        Live corridor
      </div>

      <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-[rgba(198,255,74,.3)] bg-night-950/85 p-3 text-[11px] backdrop-blur">
        <span className="font-bold text-volt-300">Matched on route</span>
        <span className="text-[#A5ABD6]">
          {" "}
          86% overlap · pickup 320 m away · driver detours only 1.2 km
        </span>
      </div>
    </div>
  );
}