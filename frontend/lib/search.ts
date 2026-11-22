// Search client: POST twins. Results carry match + src/dst km.
import type { Trip } from "@/lib/trips";

export type MatchPoint = {
  lat: number;
  lng: number;
  label?: string | null;
  along_km?: number;
  walk_km?: number;
  dest_km?: number;
};

export type MatchAlternative = {
  point: [number, number];
  along_km: number;
  walk_km: number;
  detour_km: number;
  strategy: string;
  label?: string;
};

export type MatchInfo = {
  feasible: boolean; routed: boolean; score: number;
  overlap_pct: number; pickup_km: number; dropoff_km: number;
  reason: string | null;
  weights?: { overlap: number; pickup: number; dropoff: number; time: number };
  // Minimum-detour pickup optimization (Module 10)
  route_quality?: "routed" | "straight_line" | string | null;
  detour_km?: number;
  extra_time_min?: number;
  passenger_distance_km?: number;
  estimated?: boolean;
  pickup?: MatchPoint | null;
  drop?: MatchPoint | null;
  alternatives?: MatchAlternative[];
  overlap_pct_driver?: number;
  overlap_pct_passenger?: number;
  // Module 16: learned re-rank (blended = 0.5 * rule + 0.5 * AI).
  ai_score?: number | null; blended?: number | null;
  ai_model?: string | null;
  ai_features?: { overlap01: number; pickup01: number; dropoff01: number; time01: number } | null;
  ai_contributions?: Record<string, number> | null;
};
export type RideHit = Trip & {
  src_km: number;
  dst_km: number;
  match: MatchInfo;
  estimated_contribution?: number;
  passenger_distance_km?: number;
  detour_km?: number;
  extra_time_min?: number;
  route_quality?: string;
  estimated?: boolean;
  pickup?: MatchPoint | null;
  drop?: MatchPoint | null;
  // Module 26: route option chosen by the passenger for this ride.
  selected_route?: {
    name: string;
    geometry: { type: string; coordinates: [number, number][] };
    distance_km?: number;
    duration_min?: number;
  } | null;
};
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

// ---------------------------------------------------------------------------
// Minimum-detour pickup optimisation (search-with-detour)
// ---------------------------------------------------------------------------
export type DetourRideResult = {
  trip_id: string;
  driver_name: string;
  vehicle: {
    make?: string | null; model?: string | null; plate_no?: string | null;
    fuel_type?: string | null; mileage_kmpl?: number | null;
  };
  seats_available: number;
  departure_time: string;
  pickup_point: { lat: number; lng: number; address?: string | null };
  drop_point: { lat: number; lng: number; address?: string | null };
  walk_distance_km: number;
  detour_km: number;
  extra_time_min: number;
  passenger_distance_km: number;
  estimated_contribution: number;
  estimated: boolean;
  route_overlap_percent: number;
  driver_route_polyline: [number, number][];   // [lat, lng]
  passenger_segment_polyline: [number, number][]; // [lat, lng]
  // Module 26: route option chosen by the passenger for this ride.
  selected_route?: {
    name: string;
    geometry: { type: string; coordinates: [number, number][] };
    distance_km?: number;
    duration_min?: number;
  } | null;
};
export type DetourSearchBody = {
  source: { lat: number; lng: number; address?: string };
  destination: { lat: number; lng: number; address?: string };
  date: string;
  time?: string;
  seats?: number;
};
export type DetourSearchResp = {
  count: number; date: string;
  source: { lat: number; lng: number; address?: string };
  destination: { lat: number; lng: number; address?: string };
  results: DetourRideResult[];
};

import { req } from "@/lib/http";

export const searchApi = {
  rides: (b: SearchBody): Promise<{ count: number; results: RideHit[]; excluded?: Excluded[]; excluded_count?: number; ai?: RankInfo }> =>
    req("/search/rides", { method: "POST", body: JSON.stringify(b) }),
  rankInfo: (): Promise<RankInfo> => req("/rank/info"),
  // Module: minimum-detour pickup optimisation.
  ridesWithDetour: (b: DetourSearchBody): Promise<DetourSearchResp> =>
    req("/rides/search-with-detour", { method: "POST", body: JSON.stringify(b) }),
};

