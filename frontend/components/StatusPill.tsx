"use client";
// Connection pill: loading → connected/disconnected/error. Reused in headers.
import type { HealthResp } from "@/lib/api";

export function StatusPill({ health, error }: { health: HealthResp | null; error: string | null }) {
  if (error)
    return (
      <span className="pill pill-rose">
        Backend unreachable — start `uvicorn` on :8000
      </span>
    );
  if (!health)
    return (
      <span className="pill pill-quiet animate-pulse">
        Checking backend…
      </span>
    );
  const ok = health.db === "connected";
  return (
    <span className={ok ? "pill pill-solid" : "pill pill-volt"}>
      {ok ? "● Backend + Mongo connected" : "● Backend up · Mongo disconnected"}
    </span>
  );
}
