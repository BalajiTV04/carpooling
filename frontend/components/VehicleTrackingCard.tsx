"use client";

import * as React from "react";
import { RouteMap, type MapPin } from "@/components/RouteMap";
import { trackingApi, type LiveFix, type Trail } from "@/lib/tracking";
import { subscribeTrip, type StreamStatus } from "@/lib/live";
import type { Booking } from "@/lib/bookings";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Car,
  MapPin as MapPinIcon,
  Navigation,
  Gauge,
  Clock,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

interface VehicleTrackingCardProps {
  booking: Booking;
  title?: string;
  defaultExpanded?: boolean;
}

export function VehicleTrackingCard({
  booking,
  title = "Where is your vehicle now?",
  defaultExpanded = true,
}: VehicleTrackingCardProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [liveFix, setLiveFix] = React.useState<LiveFix | null>(null);
  const [trail, setTrail] = React.useState<Trail | null>(null);
  const [transport, setTransport] = React.useState<StreamStatus>("connecting");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastPingTime, setLastPingTime] = React.useState<Date | null>(null);

  const tripId = booking.trip_id;

  const fetchLiveLocation = React.useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [live, trailData] = await Promise.all([
        trackingApi.live(tripId).catch(() => null),
        trackingApi.trail(tripId).catch(() => null),
      ]);
      if (live) {
        setLiveFix(live);
        setLastPingTime(new Date());
      }
      if (trailData) {
        setTrail(trailData);
      }
      setError(null);
    } catch (cause) {
      if (!silent) {
        setError(cause instanceof Error ? cause.message : "Failed to load vehicle location");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tripId]);

  // Initial load and WebSocket + Polling subscription
  React.useEffect(() => {
    let active = true;
    void fetchLiveLocation();

    // 15s polling safety net
    const intervalId = setInterval(() => {
      if (active) void fetchLiveLocation(true);
    }, 15000);

    // WebSocket real-time updates
    const stream = subscribeTrip(tripId, {
      onStatus: (status) => {
        if (active) setTransport(status);
      },
      onFrame: (frame: any) => {
        if (!active) return;
        if (frame.type === "fix" && frame.fix) {
          setLiveFix((prev) => ({
            trip_id: tripId,
            trip_status: frame.trip_status || prev?.trip_status || "ongoing",
            fix: frame.fix,
            progress: frame.progress ?? prev?.progress ?? null,
            stale: false,
          }));
          setLastPingTime(new Date());
        }
      },
    });

    return () => {
      active = false;
      clearInterval(intervalId);
      stream.close();
    };
  }, [tripId, fetchLiveLocation]);

  // Determine vehicle coordinate:
  // 1. If real-time GPS fix is recorded by driver, use [lng, lat]
  // 2. Otherwise, fall back to trip departure source point
  const hasLiveFix = Boolean(liveFix?.fix);
  const defaultSourceCoords: [number, number] =
    booking.trip?.source?.point?.coordinates ||
    booking.pickup?.point?.coordinates || [77.5946, 13.0358];

  const vehicleCoords: [number, number] = hasLiveFix && liveFix?.fix
    ? [liveFix.fix.lng, liveFix.fix.lat]
    : defaultSourceCoords;

  const pickupCoords: [number, number] =
    booking.pickup?.point?.coordinates || defaultSourceCoords;
  const dropoffCoords: [number, number] =
    booking.dropoff?.point?.coordinates || [77.67, 12.8452];

  // Map pins: Vehicle + Pickup + Dropoff
  const pins: MapPin[] = [
    {
      lng: vehicleCoords[0],
      lat: vehicleCoords[1],
      label: hasLiveFix
        ? `Vehicle (${liveFix?.fix?.speed_kmph != null ? `${liveFix.fix.speed_kmph} km/h` : "Active"})`
        : "Vehicle (At Start Point)",
      color: "#10b981", // vibrant emerald
      iconType: "car",
      heading: liveFix?.fix?.heading_deg ?? 0,
      speed_kmph: liveFix?.fix?.speed_kmph ?? (hasLiveFix ? 20 : 0),
      plateNo: typeof booking.trip?.vehicle === "string" ? booking.trip.vehicle : (booking.trip?.vehicle as any)?.plate_no || "RIDE",
      driverName: booking.driver_name || "Assigned Driver",
      isSelected: true,
    },
    {
      lng: pickupCoords[0],
      lat: pickupCoords[1],
      label: `Pickup: ${booking.pickup?.name || "Your Pickup Point"}`,
      color: "#0ea5e9", // vibrant sky blue
      iconType: "pickup",
    },
    {
      lng: dropoffCoords[0],
      lat: dropoffCoords[1],
      label: `Drop: ${booking.dropoff?.name || "Your Destination"}`,
      color: "#f43f5e", // vibrant rose
      iconType: "dropoff",
    },
  ];

  // Route geometry from trip
  const routeGeometry = booking.trip?.route_geometry || {
    type: "LineString",
    coordinates: [defaultSourceCoords, dropoffCoords],
  };

  const isApproved =
    booking.status === "accepted" || booking.status === "confirmed";

  return (
    <div className="rounded-2xl border border-brand-teal/30 bg-surface shadow-md overflow-hidden transition">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-brand-teal/5 border-b border-brand-teal/15">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand-teal/20 text-brand-teal flex items-center justify-center shrink-0">
            <Car className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-sm font-bold text-ink">
                {title}
              </h3>
              <Badge variant="success" className="text-[10px]">
                <CheckCircle2 className="mr-1 h-3 w-3 inline" />
                Booking Approved
              </Badge>
            </div>
            <p className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
              <span>Driver: <strong className="text-ink">{booking.driver_name || "Verified Driver"}</strong></span>
              <span>·</span>
              <span>Vehicle: <strong className="text-ink">{booking.trip?.vehicle || "Assigned Car"}</strong></span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchLiveLocation(false)}
            disabled={refreshing}
            className="text-xs text-muted hover:text-ink flex items-center gap-1"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-semibold"
          >
            {expanded ? "Hide Map" : "Show Map →"}
          </Button>
        </div>
      </div>

      {/* Main Map View & Real-time telemetry */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Status banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card p-3 border border-line text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  hasLiveFix && !liveFix?.stale
                    ? "bg-brand-teal animate-pulse"
                    : liveFix?.stale
                    ? "bg-amber-400"
                    : "bg-muted"
                }`}
              />
              <span className="font-semibold text-ink">
                {hasLiveFix && !liveFix?.stale
                  ? "Live Vehicle GPS Connected"
                  : liveFix?.stale
                  ? "Location Temporarily Unavailable (Stale)"
                  : "Vehicle Stationed at Starting Point"}
              </span>
              <span className="text-muted text-[11px]">
                ({transport === "live" ? "Real-time push" : "Polled sync"})
              </span>
            </div>

            <div className="flex items-center gap-4 text-muted">
              {liveFix?.progress?.eta_min !== null && liveFix?.progress?.eta_min !== undefined && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-brand-teal" />
                  <span className="font-bold text-ink">~{liveFix.progress.eta_min}m ETA</span>
                </div>
              )}
              {liveFix?.fix?.speed_kmph !== null && liveFix?.fix?.speed_kmph !== undefined && (
                <div className="flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5 text-brand-teal" />
                  <span className="font-bold text-ink">{liveFix.fix.speed_kmph} km/h</span>
                </div>
              )}
              {liveFix?.progress?.remaining_km !== null && liveFix?.progress?.remaining_km !== undefined && (
                <div className="flex items-center gap-1">
                  <Navigation className="h-3.5 w-3.5 text-brand-teal" />
                  <span className="font-bold text-ink">{liveFix.progress.remaining_km} km left</span>
                </div>
              )}
              {lastPingTime && (
                <div className="hidden sm:flex items-center gap-1 text-[11px]">
                  <span>{lastPingTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
              )}
            </div>
          </div>

          {liveFix?.stale && hasLiveFix && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-500 flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0" />
              <span>
                Driver location is temporarily stale (no recent update in &gt; 5 minutes). The driver may be in a low-connectivity area or waiting at a signal.
              </span>
            </div>
          )}

          {/* Interactive Map */}
          <div className="rounded-xl overflow-hidden border border-line shadow-inner">
            <RouteMap
              geometry={routeGeometry}
              pins={pins}
              height={280}
            />
          </div>

          {/* Legend and Pickup Guide */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2.5 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-500 shrink-0 shadow-sm" />
              <div>
                <p className="font-semibold text-ink">Vehicle Location</p>
                <p className="text-[11px] text-muted truncate">
                  {hasLiveFix ? "Tracking live in transit" : "Waiting at departure point"}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-2.5 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-sky-500 shrink-0 shadow-sm" />
              <div>
                <p className="font-semibold text-ink">Your Pickup Point</p>
                <p className="text-[11px] text-muted truncate">
                  {booking.pickup?.name || "Designated pickup spot"}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-2.5 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-500 shrink-0 shadow-sm" />
              <div>
                <p className="font-semibold text-ink">Your Destination</p>
                <p className="text-[11px] text-muted truncate">
                  {booking.dropoff?.name || booking.trip?.destination_name || "Final dropoff"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
