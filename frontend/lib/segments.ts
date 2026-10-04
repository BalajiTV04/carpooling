// Segment client (Module 13): per-leg split views.
export type SegmentRow = {
  trip_id: string; seq: number;
  from_label: string; to_label: string;
  from_frac: number; to_frac: number;
  distance_km: number; leg_cost: number;
  occupant_booking_ids: string[]; occupant_names: string[];
  cost_per_occupant: number;
};

export type SegmentSummary = {
  segmented: boolean;
  reason?: string;
  segments: (SegmentRow & { shares?: Record<string, number> })[];
  totals: Record<string, number>;
  route_km?: number;
  trip_total_cap?: number;
  collected_total?: number;
  fallback_riders?: string[];
  fuel: { total_cost: number; distance_km: number; fuel_price: number; per_km: number };
  policy: { mode: string; fuel_price: number };
  riders?: number;
  trip?: { id: string; source_name: string; destination_name: string; status: string };
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

export const segmentApi = {
  summary: (tripId: string): Promise<SegmentSummary> =>
    req(`/trips/${tripId}/segments/summary`),
  legs: (tripId: string): Promise<SegmentRow[]> =>
    req(`/trips/${tripId}/segments`),
  rebuild: (tripId: string) =>
    req(`/trips/${tripId}/segments/rebuild`, { method: "POST" })
};