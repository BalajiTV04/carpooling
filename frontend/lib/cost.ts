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

export type BookingCost = {
  booking_id: string; status: string; seats: number; mode: CostPolicy;
  total_cost: number; your_share: number;
  // The whole-trip arithmetic behind total_cost, so a rider can see WHY the
  // number is what it is (car + mileage + fuel price), not just what it is.
  vehicle: { make: string | null; model: string | null; year: number | null;
             color: string | null; plate_no: string | null;
             fuel_type: string | null; mileage_kmpl: number | null };
  fuel: { distance_km: number; mileage_kmpl: number; fuel_price: number;
          litres: number; total_cost: number; per_km: number };
  inputs: { seats_offered: number; confirmed_seats: number; passengers: number };
  formula: string;
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

export const costApi = {
  setPricing: (tripId: string, b: { mode: CostPolicy; fuel_price?: number }) =>
    req(`/trips/${tripId}/pricing`, { method: "POST", body: JSON.stringify(b) }),
  trip: (tripId: string): Promise<TripCost> => req(`/trips/${tripId}/cost`),
  booking: (bookingId: string): Promise<BookingCost> => req(`/bookings/${bookingId}/cost`)
};

export const POLICY_BLURBS: Record<CostPolicy, string> = {
  split_equal: "Split with driver — total divided by everyone on board (driver included). More riders, less each.",
  per_seat: "Price the seats — each seat costs total ÷ seats offered. Unsold seats are the driver's share.",
  split_riders: "Riders split everything — only confirmed passengers share the fuel bill."
};