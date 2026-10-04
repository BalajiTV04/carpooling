// Search client: POST twins. Results carry match + src/dst km.
import type { Trip } from "@/lib/trips";

export type MatchInfo = {
  feasible: boolean; routed: boolean; score: number;
  overlap_pct: number; pickup_km: number; dropoff_km: number;
  reason: string | null;
  weights?: { overlap: number; pickup: number; dropoff: number; time: number };
  // Module 16: learned re-rank (blended = 0.5 * rule + 0.5 * AI).
  ai_score?: number | null; blended?: number | null;
  ai_model?: string | null;
  ai_features?: { overlap01: number; pickup01: number; dropoff01: number; time01: number } | null;
  ai_contributions?: Record<string, number> | null;
};
export type RideHit = Trip & { src_km: number; dst_km: number; match: MatchInfo };
export type SearchBody = {
  src_coordinates: [number, number];
  dst_coordinates: [number, number];
  date: string;
  time?: string;
  seats: number;
  radius_km?: number;
  max_pickup_km?: number;
  min_overlap_pct?: number;
  include_excluded?: boolean;
};
export type Excluded = { id: string; source_name: string; destination_name: string; reason: string };
export type RankInfo = {
  model: string; features: string[]; weights: number[] | null;
  bias: number | null; auc: { logreg: number; rf: number; xgb: number | null } | null;
  trained_at?: string; n_rows?: number;
};

function base() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
}

async function req(path: string, opts: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("voltride_token") : null;
  const res = await fetch(`${base()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ?? `Request failed (${res.status})`);
  return body;
}

export const searchApi = {
  rides: (b: SearchBody): Promise<{ count: number; results: RideHit[]; excluded?: Excluded[]; excluded_count?: number; ai?: RankInfo }> =>
    req("/search/rides", { method: "POST", body: JSON.stringify(b) }),
  rankInfo: (): Promise<RankInfo> => req("/rank/info"),
};

