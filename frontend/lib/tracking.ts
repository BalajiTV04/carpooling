// Tracking client (Module 17): driver GPS ping + trip-audience live/trail + admin fleet.
export type LiveFix = {
  trip_id: string;
  trip_status: string;
  fix: {
    lng: number;
    lat: number;
    speed_kmph: number | null;
    accuracy_m?: number | null;
    heading_deg?: number | null;
    recorded_at: string;
  } | null;
  progress?: {
    frac: number | null;
    dist_along_km: number | null;
    remaining_km: number | null;
    off_route_m: number | null;
    off_route: boolean;
    route_km: number | null;
    eta_min?: number | null;
  } | null;
  stale: boolean;
  message?: string;
};

export type Trail = {
  trip_id: string;
  trip_status: string;
  count: number;
  fixes: {
    lng: number;
    lat: number;
    speed_kmph: number | null;
    accuracy_m?: number | null;
    heading_deg?: number | null;
    recorded_at: string;
  }[];
};

export type ActiveFleetTrip = {
  trip_id: string;
  status: string;
  trip_type?: string;
  source_name: string;
  destination_name: string;
  source?: any;
  destination?: any;
  route_geometry?: { type: string; coordinates: [number, number][] } | null;
  depart_at: string;
  started_at?: string | null;
  driver: {
    id: string;
    name: string;
    phone: string;
    rating_avg?: number | null;
  };
  vehicle: {
    make?: string;
    model?: string;
    plate_no?: string;
    color?: string;
  };
  passengers: {
    booking_id: string;
    passenger_id: string;
    name: string;
    phone: string;
    seats: number;
    status: string;
    pickup?: any;
    dropoff?: any;
  }[];
  passengers_count: number;
  latest_fix: {
    lng: number | null;
    lat: number | null;
    speed_kmph?: number | null;
    accuracy_m?: number | null;
    heading_deg?: number | null;
    recorded_at?: string | null;
  } | null;
  progress?: LiveFix["progress"];
  stale: boolean;
  open_alerts: {
    id: string;
    type: string;
    severity: string;
    status: string;
    details?: any;
    created_at: string;
  }[];
  watchers: number;
};

export type ActiveFleetResponse = {
  count: number;
  trips: ActiveFleetTrip[];
};

export type TrackingResponse = {
  ok: boolean;
  trip_id: string;
  status: string;
  message: string;
};

import { req } from "@/lib/http";

export const trackingApi = {
  start: (trip_id: string): Promise<TrackingResponse> =>
    req(`/tracking/${trip_id}/start`, { method: "POST" }),

  stop: (trip_id: string): Promise<TrackingResponse> =>
    req(`/tracking/${trip_id}/stop`, { method: "POST" }),

  ping: (
    trip_id: string,
    lng: number,
    lat: number,
    speed_kmph?: number | null,
    accuracy_m?: number | null,
    heading_deg?: number | null
  ): Promise<LiveFix & { ok: boolean; started: boolean; progress: LiveFix["progress"]; recorded_at: string; pushed_to?: number }> =>
    req("/tracking/ping", {
      method: "POST",
      body: JSON.stringify({
        trip_id,
        lng,
        lat,
        speed_kmph: speed_kmph ?? null,
        accuracy_m: accuracy_m ?? null,
        heading_deg: heading_deg ?? null,
      }),
    }),

  location: (
    trip_id: string,
    lng: number,
    lat: number,
    speed_kmph?: number | null,
    accuracy_m?: number | null,
    heading_deg?: number | null
  ): Promise<LiveFix & { ok: boolean; started: boolean; progress: LiveFix["progress"]; recorded_at: string; pushed_to?: number }> =>
    req(`/tracking/${trip_id}/location`, {
      method: "POST",
      body: JSON.stringify({
        trip_id,
        lng,
        lat,
        speed_kmph: speed_kmph ?? null,
        accuracy_m: accuracy_m ?? null,
        heading_deg: heading_deg ?? null,
      }),
    }),

  live: (trip_id: string): Promise<LiveFix> => req(`/tracking/live/${trip_id}`),
  trail: (trip_id: string): Promise<Trail> => req(`/tracking/trail/${trip_id}`),
  activeFleet: (): Promise<ActiveFleetResponse> => req("/admin/tracking/active"),
};
