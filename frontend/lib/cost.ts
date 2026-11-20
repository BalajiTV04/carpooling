// Cost client (Module 12): driver pricing, trip preview, booking breakdown.
export type CostPolicy = "split_equal" | "per_seat" | "split_riders";

export type TripCost = {
  trip: { id: string; source_name: string; destination_name: string; status: string; seats_offered: number; seats_left: number };
  vehicle: { make: string | null; model: string | null; year: number | null;
             color: string | null; plate_no: string | null;
             fuel_type: string | null; mileage_kmpl: number | null };
  policy: { mode: CostPolicy; fuel_price: number };
  fuel: { distance_km: number; mileage_kmpl: number; fuel_price: number; litres: number; total_cost: number; per_km: number };
  confirmed_seats: number; passengers: number;
  shares: Record<string, number>; collected_total: number;
  per_seat_estimate: number; projected_share_if_book_1_seat_now: number;
  note: string;
};

export type CostPreview = {
  estimated_contribution: number | null;
  available: boolean;
  reason?: string;
  seats_left: number;
  can_book: boolean;
  total_cost?: number;
  driver_share?: number;
  passengers_count?: number;
  fuel_unit?: string;
};

export type FareSegment = {
  seq: number;
  from_km: number;
  to_km: number;
  km: number;
  litres: number;
  fuel_used: number;
  cost: number;
  occupants: number;
  per_person: number;
  occupant_booking_ids: string[];
  shares: Record<string, number>;
};

export type FareBreakdown = {
  available: boolean;
  reason?: string;
  route_km: number;
  fuel_unit: string;
  mileage_kmpl: number;
  fuel_price_per_unit: number;
  total_cost: number;
  driver_share: number;
  passengers_total: number;
  seats_left: number;
  segments: FareSegment[];
  passengers: Record<string, { amount: number; name?: string; seats?: number; pickup_along_km?: number; drop_along_km?: number }>;
  is_driver: boolean;
};

export type BookingCost = {
  booking_id: string; status: string; seats: number; mode: CostPolicy;
  total_cost: number; your_share: number;
  vehicle: { make: string | null; model: string | null; year: number | null;
             color: string | null; plate_no: string | null;
             fuel_type: string | null; mileage_kmpl: number | null };
  fuel: { distance_km: number; mileage_kmpl: number; fuel_price: number;
          litres: number; total_cost: number; per_km: number };
  inputs: { seats_offered: number; confirmed_seats: number; passengers: number };
  formula: string;
};

import { req } from "@/lib/http";

export const costApi = {
  setPricing: (tripId: string, b: { mode: CostPolicy; fuel_price?: number }) =>
    req(`/trips/${tripId}/pricing`, { method: "POST", body: JSON.stringify(b) }),
  trip: (tripId: string): Promise<TripCost> => req(`/trips/${tripId}/cost`),
  booking: (bookingId: string): Promise<BookingCost> => req(`/bookings/${bookingId}/cost`),
  // Module 12+: segment-based preview + fare breakdown
  costPreview: (tripId: string, pickupAlongKm: number, dropAlongKm: number, seats?: number): Promise<CostPreview> =>
    req("/cost/preview", {
      method: "POST",
      body: JSON.stringify({ trip_id: tripId, pickup_along_km: pickupAlongKm, drop_along_km: dropAlongKm, seats: seats ?? 1 }),
    }),
  fareBreakdown: (tripId: string): Promise<FareBreakdown> =>
    req(`/trips/${tripId}/fare-breakdown`),
};

export const POLICY_BLURBS: Record<CostPolicy, string> = {
  split_equal: "Split with driver — total divided by everyone on board (driver included). More riders, less each.",
  per_seat: "Price the seats — each seat costs total ÷ seats offered. Unsold seats are the driver's share.",
  split_riders: "Riders split everything — only confirmed passengers share the fuel bill."
};