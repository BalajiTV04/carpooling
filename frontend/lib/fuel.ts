// Fuel price + distance estimate (mirrors backend /api/v1/fuel/*).
// Used by driver & passenger dashboards before any plan is created so the km
// and cost are visible up front.
import { req } from "@/lib/http";

export type FuelPrice = {
  petrol: number; diesel: number; cng: number; ev: number;
  hybrid: number; updated_at: string;
};

export type DistanceEstimate = {
  distance_km: number; fuel_type: string;
  fuel_price_per_litre: number; mileage_kmpl: number;
  estimated_fuel_cost: number; cost_per_km: number;
  seats: number; per_passenger_share: number; note: string;
};

export const fuelApi = {
  price: (): Promise<FuelPrice> => req("/fuel/price"),
  distance: (b: {
    from_lat: number; from_lng: number;
    to_lat: number; to_lng: number;
    fuel_type?: string; mileage_kmpl?: number; seats?: number;
  }) => {
    const qs = new URLSearchParams({
      from_lat: String(b.from_lat), from_lng: String(b.from_lng),
      to_lat: String(b.to_lat), to_lng: String(b.to_lng),
      ...(b.fuel_type ? { fuel_type: b.fuel_type } : {}),
      ...(b.mileage_kmpl ? { mileage_kmpl: String(b.mileage_kmpl) } : {}),
      ...(b.seats ? { seats: String(b.seats) } : {}),
    });
    return req(`/fuel/distance?${qs.toString()}`);
  },
};
