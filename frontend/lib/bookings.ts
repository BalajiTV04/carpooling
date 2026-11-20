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
  estimated_contribution?: number | null;
  fare_changed?: boolean | null;
  previous_amount?: number | null;
  fare_history?: Array<{ amount: number; previous_amount: number; reason: string; occupants: number; at: string }>;
  trip?: {
    id?: string;
    source_name: string; destination_name: string; depart_at: string;
    source?: { name: string; point: { type: "Point"; coordinates: [number, number] } };
    destination?: { name: string; point: { type: "Point"; coordinates: [number, number] } };
    route_geometry?: { type: string; coordinates: [number, number][] } | null;
    status: string; vehicle: string | null; seats_offered: number;
    seats_booked?: number; seats_left?: number;
    vehicle_details?: { make?: string; model?: string; plate_no?: string; fuel_type?: string; mileage_kmpl?: number } | null;
  } | null;
  passenger_name?: string | null; driver_name?: string | null;
};

export type AcceptPreview = {
  booking_id: string;
  route_km: number;
  fuel_unit: string;
  before: {
    passengers: Record<string, number>;
    driver_share: number;
    total_cost: number;
    seats_left: number;
  };
  after: {
    passengers: Record<string, number>;
    driver_share: number;
    total_cost: number;
    seats_left: number;
  };
};

import { req } from "@/lib/http";

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
  cancel: (id: string): Promise<Booking> => req(`/bookings/${id}/cancel`, { method: "POST" }),
  // Module 12+: driver preview before approving a booking request.
  acceptPreview: (id: string): Promise<AcceptPreview> =>
    req(`/bookings/${id}/accept-preview`),
};

export function statusPillCls(s: BookingStatus) {
  return s === "confirmed" || s === "completed"
    ? "bg-brand-teal text-on-brand-teal"
    : s === "accepted"
      ? "bg-accent text-on-accent"
      : s === "requested"
        ? "border border-brand-teal/60 text-brand-teal"
        : s === "rejected"
          ? "border border-rose-400/50 text-rose-300"
          : "border border-brand/40 text-muted";
}
