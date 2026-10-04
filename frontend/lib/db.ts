// Shared shape of /api/v1/db/stats rows.
export type DbStats = {
  collections: Record<string, { count: number; indexes: string[]; geo: string[]; missing?: boolean }>;
};

const FALLBACK: DbStats = {
  collections: {
    users: { count: 0, indexes: ["uq_users_phone"], geo: [] },
    vehicles: { count: 0, indexes: ["uq_vehicles_plate"], geo: [] },
    trips: { count: 0, indexes: ["geo_trips_source", "geo_trips_dest", "geo_trips_route"], geo: ["geo_trips_source"] },
    bookings: { count: 0, indexes: ["geo_bookings_pickup"], geo: ["geo_bookings_pickup"] },
    segments: { count: 0, indexes: ["uq_segments_trip_seq"], geo: [] },
    locations: { count: 0, indexes: ["geo_locations_point", "ttl_locations_30d"], geo: ["geo_locations_point"] },
    safety_alerts: { count: 0, indexes: ["ix_alerts_admin"], geo: [] }
  }
};

export async function fetchDbStats(): Promise<DbStats> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  const res = await fetch(`${base}/db/stats`, { cache: "no-store" });
  if (!res.ok) return FALLBACK; // backend down → render contract from Module 2 spec
  return res.json();
}

export async function initDb(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  await fetch(`${base}/db/init`, { method: "POST" });
}
