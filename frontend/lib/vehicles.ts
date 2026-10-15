// Garage client: my vehicles CRUD (driver) + admin verify helpers.
export type Vehicle = {
  id: string; make: string; model: string; year: number | null;
  color: string | null; plate_no: string; seats_total: number;
  fuel_type: string; mileage_kmpl: number | null;
  image_url: string | null;
  verification_status: "pending" | "verified" | "rejected";
  is_active: boolean; trips_as_vehicle: number;
};

import { req } from "@/lib/http";

export const vehicleApi = {
  list: (inactive = false): Promise<Vehicle[]> =>
    req(`/vehicles${inactive ? "?include_inactive=true" : ""}`),
  create: (b: object): Promise<Vehicle> =>
    req("/vehicles", { method: "POST", body: JSON.stringify(b) }),
  update: (id: string, b: object): Promise<Vehicle> =>
    req(`/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  remove: (id: string) => req(`/vehicles/${id}`, { method: "DELETE" })
};

export function badge(status: Vehicle["verification_status"]) {
  return status === "verified"
    ? "bg-volt-400 text-night-950"
    : status === "rejected"
      ? "bg-rose-500/20 text-rose-300 border border-rose-400/50"
      : "bg-night-800 text-volt-300 border border-volt-400/40";
}
