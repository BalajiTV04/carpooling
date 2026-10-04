// Trip client: driver publish flow + shared Trip shape.
export type GeoPoint = { type: "Point"; coordinates: [number, number] };
export type PlaceRef = { name: string; address?: string | null; point: GeoPoint };
export type Trip = {
  id: string; source_name: string; destination_name: string;
  source: PlaceRef; destination: PlaceRef;
  depart_at: string; seats_offered: number; seats_booked: number;
  seats_left: number; vehicle_id: string; status: string;
  distance_km: number | null; duration_min?: number | null;
};

// Module 19: post-trip receipt (read-only, money frozen at completion).
export type TripSummary = {
  trip_id: string; status: string; completed: boolean;
  source_name: string | null; destination_name: string | null;
  distance_km: number | null; seats_offered: number; seats_sold: number;
  occupancy_pct: number; passengers: number; collected_total: number;
  auto_rejected: number; depart_at: string | null;
  completed_at: string | null; duration_min: number | null;
  bookings: { booking_id: string; passenger_id: string; seats: number;
              cost_share: number }[];
  note: string;
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

export const tripApi = {
  mine: (): Promise<Trip[]> => req("/trips/mine"),
  create: (b: object): Promise<Trip> =>
    req("/trips", { method: "POST", body: JSON.stringify(b) }),
  update: (id: string, b: object): Promise<Trip> =>
    req(`/trips/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  publish: (id: string): Promise<Trip> =>
    req(`/trips/${id}/publish`, { method: "POST" }),
  cancel: (id: string): Promise<Trip> =>
    req(`/trips/${id}/cancel`, { method: "POST" }),
  remove: (id: string) => req(`/trips/${id}`, { method: "DELETE" }),
  // Module 19: explicit lifecycle close.
  start: (id: string): Promise<Trip> =>
    req(`/trips/${id}/start`, { method: "POST" }),
  complete: (id: string): Promise<TripSummary & { segments_persisted: number }> =>
    req(`/trips/${id}/complete`, { method: "POST" }),
  summary: (id: string): Promise<TripSummary> => req(`/trips/${id}/summary`)
};

export function statusCls(s: string) {
  return s === "published"
    ? "bg-volt-400 text-night-950"
    : s === "draft"
      ? "border border-volt-400/50 text-volt-300"
      : s === "cancelled"
        ? "border border-rose-400/50 text-rose-300"
        : "border border-[rgba(154,151,255,.4)] text-iris-300";
}
