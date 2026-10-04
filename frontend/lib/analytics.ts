// Analytics client (Module 24): sustainability, demand forecast, model
// evaluation. The first three describe the whole platform and are admin-only;
// /me is open to any logged-in user and is the demo-friendly surface.
export type Impact = {
  trips: number; riders: number; seats_shared: number;
  solo_km: number; shared_km: number; km_avoided: number;
  vehicles_avoided: number; fuel_saved_l: number; co2_avoided_kg: number;
  cost_saved: number; paid_total: number; solo_cost_total: number;
  unfavourable_riders: number;
  by_fuel: Record<string, {
    trips: number; km_avoided: number; co2_avoided_kg: number;
    vehicles_avoided: number; cost_saved: number;
  }>;
  emission_basis?: string; note?: string; scope?: string; generated_at?: string;
};

export type DemandBucket = {
  bucket: string; weekday: string; hour: number;
  observed: number; per_day: number; horizon_total: number;
};

export type Backtest = {
  n: number; mae: number | null; rmse: number | null;
  n_train?: number; n_test?: number; train_days?: number;
  test_days?: number; cutoff?: string; note?: string;
};

export type Demand = {
  samples: number; horizon_days: number; shrink_k: number;
  global_mean_per_bucket: number;
  busiest: DemandBucket[]; quietest: DemandBucket[];
  buckets?: DemandBucket[];
  backtest: Backtest;
  history: { trips: number; window_days: number; seats_offered: number; seats_booked: number };
  method: string;
};

export type ScoreMetrics = {
  field: string; n: number; auc: number | null; f1: number | null;
  precision?: number; recall?: number; accuracy?: number;
  threshold?: number; tp?: number; fp?: number; fn?: number; tn?: number;
  positives?: number; negatives?: number; note?: string;
};

export type Evaluation = {
  samples: number; labelled: number;
  rule_score: ScoreMetrics; ai_score: ScoreMetrics;
  comparison: { winner: string; delta_auc: number } | null;
  offline_ranker_auc: Record<string, number> | null;
  deployed_model: string | null;
  label_definition: string; caveat: string;
};

export type MyImpact = {
  trips_as_driver: number; trips_as_rider: number;
  as_driver: Impact; as_rider: Impact;
  paid_total: number; collected_total: number; net: number; note: string;
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

export const analyticsApi = {
  impact: (): Promise<Impact> => req("/analytics/impact"),
  demand: (horizonDays = 14, withBuckets = false): Promise<Demand> =>
    req(`/analytics/demand?horizon_days=${horizonDays}&buckets=${withBuckets}`),
  evaluation: (): Promise<Evaluation> => req("/analytics/evaluation"),
  mine: (): Promise<MyImpact> => req("/analytics/me")
};