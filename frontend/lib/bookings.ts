// Booking client (Modules 11 + 19): request → accept/reject → confirm
// (+cancel); completion settles rides and freezes money.
export type BookingStatus =
  | "requested" | "accepted" | "confirmed" | "rejected" | "cancelled" | "completed";

export type Booking = {
  id: string; trip_id: string; passenger_id: string; driver_id: string;
  seats: number; status: BookingStatus;
  pickup: { name: string | null; point: { type: "Point"; coordinates: [number, number] } };
  dropoff: { name: string | null; point: { type: "Point"; coordinates: [number, number] } };
  pickup_distance_m: number | null; detour_km: number | null;
  overlap_pct: number | null; cost_share: number | null;
  closed_at?: string | null; closure_note?: string | null;
  trip?: {
    source_name: string; destination_name: string; depart_at: string;
    status: string; vehicle: string | null; seats_offered: number;
  } | null;
  passenger_name?: string | null; driver_name?: string | null;
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

export const bookingApi = {
  create: (b: {
    trip_id: string; seats: number;
    pickup_coordinates: [number, number];
    dropoff_coordinates: [number, number];
    use_optimised_pickup?: boolean;
  }): Promise<Booking> =>
    req("/bookings", { method: "POST", body: JSON.stringify(b) }),
  mine: (): Promise<Booking[]> => req("/bookings/mine"),
  incoming: (): Promise<Booking[]> => req("/bookings/incoming"),
  get: (id: string): Promise<Booking> => req(`/bookings/${id}`),
  accept: (id: string): Promise<Booking> => req(`/bookings/${id}/accept`, { method: "POST" }),
  reject: (id: string): Promise<Booking> => req(`/bookings/${id}/reject`, { method: "POST" }),
  confirm: (id: string): Promise<Booking> => req(`/bookings/${id}/confirm`, { method: "POST" }),
  cancel: (id: string): Promise<Booking> => req(`/bookings/${id}/cancel`, { method: "POST" })
};

export function statusPillCls(s: BookingStatus) {
  return s === "confirmed" || s === "completed"
    ? "bg-volt-400 text-night-950"
    : s === "accepted"
      ? "bg-iris-500 text-white"
      : s === "requested"
        ? "border border-volt-400/60 text-volt-300"
        : s === "rejected"
          ? "border border-rose-400/50 text-rose-300"
          : "border border-[rgba(154,151,255,.4)] text-[#A5ABD6]";
}