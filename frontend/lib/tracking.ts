// Tracking client (Module 17): driver ping + trip-audience live/trail.
export type LiveFix = {
  trip_id: string; trip_status: string;
  fix: { lng: number; lat: number; speed_kmph: number | null; recorded_at: string } | null;
  progress?: {
    frac: number | null; dist_along_km: number | null; remaining_km: number | null;
    off_route_m: number | null; off_route: boolean; route_km: number | null;
  } | null;
  stale: boolean; message?: string;
};
export type Trail = {
  trip_id: string; trip_status: string; count: number;
  fixes: { lng: number; lat: number; speed_kmph: number | null; recorded_at: string }[];
};

import { req } from "@/lib/http";

export const trackingApi = {
  ping: (trip_id: string, lng: number, lat: number, speed_kmph?: number | null): Promise<LiveFix & { ok: boolean; started: boolean; progress: LiveFix["progress"]; recorded_at: string }> =>
    req("/tracking/ping", { method: "POST", body: JSON.stringify({ trip_id, lng, lat, speed_kmph: speed_kmph ?? null }) }),
  live: (trip_id: string): Promise<LiveFix> => req(`/tracking/live/${trip_id}`),
  trail: (trip_id: string): Promise<Trail> => req(`/tracking/trail/${trip_id}`),
};
