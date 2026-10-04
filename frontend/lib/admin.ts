// Admin client (Module 21): dashboard cards, user moderation, trip board,
// alert queue + resolution. All routes are require_roles("admin") server-side.
export type AdminUser = {
  id: string; phone: string | null; full_name: string | null;
  roles: string[]; phone_verified: boolean; status: string;
  rating_avg: number | null; rating_count: number; created_at: string | null;
};

export type AdminStats = {
  users: { total: number; active: number; suspended: number; drivers: number;
           passengers: number; admins: number; phone_verified: number;
           verified_pct: number };
  vehicles: { total: number; pending: number; verified: number; rejected: number };
  trips: { total: number; by_status: Record<string, number>; live: number;
           completed: number; completion_rate_pct: number };
  bookings: { total: number; by_status: Record<string, number>; settled_seats: number };
  alerts: { total: number; open: number; by_severity: Record<string, number>;
            critical_open: number };
  locations: number;
  stream: { trips: number; sockets: number; pushed: number; dropped: number;
            last_error: string | null; scope: string };
  generated_at: string;
};

export type AdminAlert = {
  id: string; trip_id: string; type: string; severity: string; status: string;
  point: { type: "Point"; coordinates: [number, number] } | null;
  details: Record<string, unknown> | null;
  created_at: string; resolved_at: string | null;
  source_name?: string; destination_name?: string; driver_name?: string;
};

export type AdminTrip = {
  id: string; source_name: string; destination_name: string; depart_at: string;
  status: string; seats_offered: number; seats_booked: number;
  driver_name: string | null; driver_id: string; tracked: boolean;
  open_alerts: number; recurring: boolean;
};

// Module 5 route reused (not duplicated): pending cars + the verify decision.
export type PendingVehicle = {
  id: string; make: string; model: string; year: number | null;
  plate_no: string; seats_total: number; fuel_type: string;
  verification_status: string; is_active: boolean;
};

function base() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
}

async function req(path: string, opts: RequestInit = {}) {
  const tok = typeof window !== "undefined" ? localStorage.getItem("voltride_token") : null;
  const res = await fetch(`${base()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(opts.headers ?? {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ?? `Request failed (${res.status})`);
  return body;
}

export const adminApi = {
  stats: (): Promise<AdminStats> => req("/admin/stats"),
  users: (q = "", status = "", role = ""): Promise<{ total: number; count: number; users: AdminUser[] }> =>
    req(`/admin/users?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&role=${encodeURIComponent(role)}`),
  suspend: (id: string) => req(`/admin/users/${id}/suspend`, { method: "POST" }),
  reactivate: (id: string) => req(`/admin/users/${id}/reactivate`, { method: "POST" }),
  roles: (id: string, role: string, action: "add" | "remove") =>
    req(`/admin/users/${id}/roles`, { method: "POST", body: JSON.stringify({ role, action }) }),
  trips: (liveOnly = false, status = ""): Promise<{ count: number; trips: AdminTrip[] }> =>
    req(`/admin/trips?live_only=${liveOnly ? "true" : "false"}&status=${encodeURIComponent(status)}`),
  alerts: (status = "open", severity = ""): Promise<{ count: number; alerts: AdminAlert[] }> =>
    req(`/admin/alerts?status=${encodeURIComponent(status)}&severity=${encodeURIComponent(severity)}`),
  resolve: (id: string) => req(`/admin/alerts/${id}/resolve`, { method: "POST" }),
  // Module 5 admin routes, surfaced inside the console (no duplication).
  pendingVehicles: (): Promise<PendingVehicle[]> => req("/vehicles/admin/pending"),
  verifyVehicle: (id: string, decision: "verified" | "rejected", note = "") =>
    req(`/vehicles/admin/${id}/verify?decision=${decision}&note=${encodeURIComponent(note)}`,
      { method: "POST" }),
};

export function severityCls(sev: string) {
  return sev === "critical"
    ? "border border-rose-400/60 bg-rose-500/15 text-rose-200"
    : sev === "high"
      ? "border border-orange-400/50 bg-orange-500/10 text-orange-200"
      : "border border-amber-400/40 bg-amber-500/10 text-amber-200";
}
