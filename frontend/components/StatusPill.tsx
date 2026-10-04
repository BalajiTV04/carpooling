"use client";
// Connection pill: loading → connected/disconnected/error. Reused in headers.
import type { HealthResp } from "@/lib/api";

export function StatusPill({ health, error }: { health: HealthResp | null; error: string | null }) {
  if (error)
    return (
      <span className="rounded-full border border-red-400/40 bg-red-500/10 px-4 py-1.5 text-sm text-red-300">
        Backend unreachable — start `uvicorn` on :8000
      </span>
    );
  if (!health)
    return (
      <span className="animate-pulse rounded-full border border-[rgba(154,151,255,.3)] px-4 py-1.5 text-sm text-[#A5ABD6]">
        Checking backend…
      </span>
    );
  const ok = health.db === "connected";
  return (
    <span
      className={
        ok
          ? "rounded-full bg-volt-400 px-4 py-1.5 text-sm font-semibold text-night-950 shadow-glow"
          : "rounded-full border border-volt-400/50 px-4 py-1.5 text-sm text-volt-300"
      }
    >
      {ok ? "● Backend + Mongo connected" : "● Backend up · Mongo disconnected"}
    </span>
  );
}
