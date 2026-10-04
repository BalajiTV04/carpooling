// Star rating display (read-only here; Module 22 writes ratings).
export function Stars({ avg, count }: { avg: number | null; count: number }) {
  if (avg === null || avg === undefined)
    return <span className="text-xs text-[#5b6194]">★ new — no ratings yet</span>;
  return (
    <span className="text-sm text-volt-300">
      {"★".repeat(Math.round(avg))}{"☆".repeat(5 - Math.round(avg))}
      <span className="ml-1 text-xs text-[#A5ABD6]">{avg.toFixed(1)} ({count})</span>
    </span>
  );
}
