// Brand mark for VoltRide: a route pin carrying a car.
//
// Before this existed the logo was literally a letter "V" in a lime square —
// nothing about it said "vehicles" or "routes". This SVG draws the product's
// actual idea: a map pin whose outline is a road, with a car sitting on it.
// It is inline SVG (no asset request) and inherits the volt->iris gradient so
// it matches the theme in the nav, the footer and the auth pages.
export function BrandMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  const id = "vm-grad";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="VoltRide"
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D8FF7A" />
          <stop offset="100%" stopColor="#AEEB2E" />
        </linearGradient>
      </defs>

      {/* Rounded badge */}
      <rect x="0" y="0" width="40" height="40" rx="12" fill={`url(#${id})`} />

      {/* Road curve inside the badge — the dashed centre line travels. */}
      <path d="M7 30 Q20 30 20 20 Q20 10 33 10" stroke="#070A1A" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.55" />
      <path
        d="M7 30 Q20 30 20 20 Q20 10 33 10"
        stroke="#070A1A"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="3 3"
        className="route-dash"
      />

      {/* Origin + destination dots */}
      <circle cx="7" cy="30" r="2.6" fill="#070A1A" />
      <circle cx="33" cy="10" r="2.6" fill="#070A1A" />

      {/* Car body on the route */}
      <g transform="translate(15.5 16.5)">
        <rect x="0" y="2" width="9" height="4.6" rx="1.6" fill="#070A1A" />
        <path d="M1.6 2 L3 0.2 H6 L7.4 2 Z" fill="#070A1A" />
        <circle cx="2.1" cy="7" r="1.2" fill="#070A1A" />
        <circle cx="6.9" cy="7" r="1.2" fill="#070A1A" />
      </g>
    </svg>
  );
}
