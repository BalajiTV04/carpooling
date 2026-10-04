// Pickup-point optimisation client (Module 10) + simplified route geometry.
export type PickupPoint = {
  coordinates: [number, number];
  km_from_start: number;
  frac: number;
  walk_km: number;
  walk_min: number;
  detour_km: number;        // what the driver pays under this strategy
  door_detour_km: number;   // deviation if the driver went to the door
  detour_min: number;
  strategy: "walk" | "door";
  cost: number;
  walkable: boolean;
  label?: string;
  why?: string;
};

export type PickupOptions = {
  chosen: PickupPoint | null;
  alternates: PickupPoint[];
  considered: number;
  step_km: number;   // grid spacing used when scanning candidates
  max_walk_km: number;
  walk_weight: number;
  mode: string;
  route_km: number;
  baseline_detour_km: number;
  saved_detour_km: number;
  reason: string | null;
  trip: { id: string; source_name: string; destination_name: string; distance_km: number | null; routed: boolean };
};

export type TripRoute = {
  trip_id: string; routed: boolean; distance_km: number | null;
  duration_min: number | null;
  geometry: { type: "LineString"; coordinates: [number, number][] };
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

export const pickupApi = {
  options: (
    tripId: string,
    b: {
      pickup_coordinates: [number, number];
      dropoff_coordinates: [number, number];
      mode?: "auto" | "walk" | "door";
      max_walk_km?: number;
      label_places?: boolean;
    }
  ): Promise<PickupOptions> =>
    req(`/trips/${tripId}/pickup-options`, { method: "POST", body: JSON.stringify(b) }),
  route: (tripId: string, maxPoints = 250): Promise<TripRoute> =>
    req(`/trips/${tripId}/route?max_points=${maxPoints}`)
};