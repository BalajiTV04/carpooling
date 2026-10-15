// Safety client (Module 18): SOS panic button + alert banner feed + ack.
export type SafetyAlert = {
  id: string; trip_id: string; booking_id: string | null;
  type: "sos" | "speed" | "deviation"; severity: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved";
  point: { type: "Point"; coordinates: [number, number] } | null;
  details: Record<string, unknown> | null;
  created_at: string; resolved_at: string | null;
};

import { req } from "@/lib/http";

export const safetyApi = {
  sos: (trip_id: string, message?: string): Promise<SafetyAlert> =>
    req("/safety/sos", { method: "POST", body: JSON.stringify({ trip_id, message: message ?? null }) }),
  trip: (trip_id: string): Promise<{ trip_id: string; count: number; open: number; alerts: SafetyAlert[] }> =>
    req(`/safety/trip/${trip_id}`),
  ack: (alert_id: string): Promise<SafetyAlert> =>
    req(`/safety/${alert_id}/ack`, { method: "POST" }),
};

export function severityCls(s: SafetyAlert["severity"]) {
  return s === "critical"
    ? "border border-rose-400/60 bg-rose-500/15 text-rose-200"
    : s === "high"
      ? "border border-orange-400/50 bg-orange-500/10 text-orange-200"
      : "border border-amber-400/40 bg-amber-500/10 text-amber-200";
}
