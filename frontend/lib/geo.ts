// Geo client: search / reverse / route preview via backend (login required).
export type PlaceHit = { name: string; address: string | null; lat: number; lng: number };
export type RoutePreview = {
  routed: boolean;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  distance_km: number;
  duration_min: number | null;
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

export const geoApi = {
  search: (q: string): Promise<PlaceHit[]> =>
    req(`/geo/search?q=${encodeURIComponent(q)}&limit=5`),
  reverse: (lat: number, lng: number): Promise<PlaceHit> =>
    req(`/geo/reverse?lat=${lat}&lng=${lng}`),
  route: (src: [number, number], dst: [number, number]): Promise<RoutePreview> =>
    req("/geo/route", { method: "POST", body: JSON.stringify({ src, dst }) }),
  refreshTrip: (id: string) =>
    req(`/trips/${id}/route/refresh`, { method: "POST" })
};
