"use client";

import * as React from "react";
import { trackingApi, type ActiveFleetTrip } from "@/lib/tracking";
import { RouteMap, type MapPin } from "@/components/RouteMap";
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
  AlertTriangle,
  Users,
  Phone,
  Radio,
  Search,
} from "lucide-react";

export function AdminFleetMap() {
  const [fleetTrips, setFleetTrips] = React.useState<ActiveFleetTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = React.useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  const fetchActiveFleet = React.useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await trackingApi.activeFleet();
      setFleetTrips(res.trips || []);
      setLastRefreshed(new Date());
      setError(null);
      // Auto-select first trip if none selected
      if (!selectedTripId && res.trips && res.trips.length > 0) {
        setSelectedTripId(res.trips[0].trip_id);
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Failed to load active fleet");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTripId]);

  // Initial load and 10s auto-refresh
  React.useEffect(() => {
    let active = true;
    void fetchActiveFleet(false);

    const interval = setInterval(() => {
      if (active) void fetchActiveFleet(true);
    }, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchActiveFleet]);

  const selectedTrip = fleetTrips.find((t) => t.trip_id === selectedTripId) || fleetTrips[0];

  // Filter trips by driver name, destination or vehicle plate
  const filteredTrips = fleetTrips.filter((t) => {
    const q = searchQuery.toLowerCase();
    return (
      t.driver.name.toLowerCase().includes(q) ||
      t.destination_name.toLowerCase().includes(q) ||
      t.source_name.toLowerCase().includes(q) ||
      (t.vehicle.plate_no || "").toLowerCase().includes(q)
    );
  });

  // Collect map pins for all active vehicles, with special focus for selected trip
  const pins: MapPin[] = [];
  fleetTrips.forEach((t) => {
    if (t.latest_fix?.lat != null && t.latest_fix?.lng != null) {
      const isSelected = t.trip_id === selectedTrip?.trip_id;
      pins.push({
        lat: t.latest_fix.lat,
        lng: t.latest_fix.lng,
        label: `${t.vehicle.plate_no || "Car"} · Driver: ${t.driver.name}`,
        color: isSelected ? "#14b8a6" : "#6366f1", // teal for selected, indigo for others
        iconType: "car",
        heading: t.latest_fix.heading_deg ?? 0,
        speed_kmph: t.latest_fix.speed_kmph ?? 0,
        plateNo: t.vehicle.plate_no || "CAB",
        driverName: t.driver.name,
        isSelected,
      });
    }
  });

  // Add source and destination pins for the selected trip
  if (selectedTrip) {
    if (selectedTrip.source?.point?.coordinates) {
      pins.push({
        lng: selectedTrip.source.point.coordinates[0],
        lat: selectedTrip.source.point.coordinates[1],
        label: `Start: ${selectedTrip.source_name}`,
        color: "#0ea5e9",
        iconType: "pickup",
      });
    }
    if (selectedTrip.destination?.point?.coordinates) {
      pins.push({
        lng: selectedTrip.destination.point.coordinates[0],
        lat: selectedTrip.destination.point.coordinates[1],
        label: `Destination: ${selectedTrip.destination_name}`,
        color: "#f43f5e",
        iconType: "dropoff",
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 rounded-full bg-brand-teal animate-pulse" />
            <h2 className="font-display font-bold text-xl text-ink">
              Live Fleet Monitoring
            </h2>
          </div>
          <p className="text-xs text-muted mt-1">
            Real-time GPS tracking of active vehicles, route corridors, safety alerts, and passenger manifests.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant={fleetTrips.length > 0 ? "success" : "muted"} className="text-xs">
            <Radio className="h-3 w-3 mr-1 inline animate-pulse" />
            {fleetTrips.length} Active Ride{fleetTrips.length === 1 ? "" : "s"}
          </Badge>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchActiveFleet(false)}
            disabled={refreshing}
            className="text-xs text-muted hover:text-ink flex items-center gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Main Grid: Left List (1 col) + Right Map & Details (2 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Rides Sidebar */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search driver, route, or plate…"
              className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2 text-xs text-ink outline-none focus:border-brand-teal"
            />
          </div>

          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {filteredTrips.length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-8 text-center text-xs text-muted">
                <Car className="mx-auto h-8 w-8 text-muted/40 mb-2" />
                <p className="font-semibold text-ink">No active rides</p>
                <p className="text-[11px] mt-0.5">
                  Vehicles currently on ongoing trips will appear here with live GPS telemetry.
                </p>
              </div>
            ) : (
              filteredTrips.map((trip) => {
                const isSelected = selectedTrip?.trip_id === trip.trip_id;
                const hasFix = Boolean(trip.latest_fix?.lat);
                const hasAlerts = trip.open_alerts && trip.open_alerts.length > 0;
                const isOffRoute = trip.progress?.off_route;

                return (
                  <div
                    key={trip.trip_id}
                    onClick={() => setSelectedTripId(trip.trip_id)}
                    className={`cursor-pointer rounded-xl p-4 border transition ${
                      isSelected
                        ? "border-brand-teal bg-brand-teal/5 shadow-sm"
                        : "border-line bg-surface hover:border-brand-teal/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-xs font-bold text-ink">
                        {trip.vehicle.plate_no || "Car"} · {trip.vehicle.make} {trip.vehicle.model}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          hasFix && !trip.stale
                            ? "bg-brand-teal/15 text-brand-teal"
                            : "bg-amber-400/15 text-amber-500"
                        }`}
                      >
                        {hasFix && !trip.stale ? "LIVE GPS" : "STALE FIX"}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs">
                      <p className="text-muted flex items-center gap-1.5 truncate">
                        <MapPinIcon className="h-3.5 w-3.5 text-brand-teal shrink-0" />
                        <span className="font-medium text-ink truncate">
                          {trip.source_name} → {trip.destination_name}
                        </span>
                      </p>
                      <p className="text-muted text-[11px]">
                        Driver: <strong className="text-ink">{trip.driver.name}</strong> ({trip.driver.phone})
                      </p>
                    </div>

                    {/* Alerts / Deviation badges */}
                    {(hasAlerts || isOffRoute) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {isOffRoute && (
                          <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Off-route ({trip.progress?.off_route_m}m)
                          </span>
                        )}
                        {hasAlerts && (
                          <span className="text-[10px] bg-warn/10 text-warn border border-warn/20 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {trip.open_alerts.length} Alert{trip.open_alerts.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="mt-3 pt-2 border-t border-line/60 flex items-center justify-between text-[11px] text-muted">
                      <span>Speed: <strong className="text-ink">{trip.latest_fix?.speed_kmph ?? 0} km/h</strong></span>
                      <span>{trip.passengers_count} passenger{trip.passengers_count === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Trip Details & Interactive Live Map */}
        <div className="lg:col-span-2 space-y-4">
          {selectedTrip ? (
            <>
              {/* Telemetry bar for selected trip */}
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-3 border-b border-line">
                  <div>
                    <h3 className="font-display font-bold text-base text-ink">
                      {selectedTrip.source_name} → {selectedTrip.destination_name}
                    </h3>
                    <p className="text-xs text-muted">
                      Trip ID: <span className="font-mono text-ink">{selectedTrip.trip_id}</span> · Status:{" "}
                      <strong className="text-brand-teal uppercase">{selectedTrip.status}</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">
                      Audience: <strong className="text-ink">{selectedTrip.watchers} active socket(s)</strong>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl bg-card p-2.5 border border-line">
                    <span className="text-[10px] text-muted uppercase font-bold block">Vehicle Speed</span>
                    <p className="font-display text-base font-bold text-ink mt-0.5">
                      {selectedTrip.latest_fix?.speed_kmph !== null && selectedTrip.latest_fix?.speed_kmph !== undefined
                        ? `${selectedTrip.latest_fix.speed_kmph} km/h`
                        : "0 km/h"}
                    </p>
                  </div>

                  <div className="rounded-xl bg-card p-2.5 border border-line">
                    <span className="text-[10px] text-muted uppercase font-bold block">Progress</span>
                    <p className="font-display text-base font-bold text-brand-teal mt-0.5">
                      {selectedTrip.progress?.frac !== null && selectedTrip.progress?.frac !== undefined
                        ? `${Math.round(selectedTrip.progress.frac * 100)}%`
                        : "0%"}
                    </p>
                  </div>

                  <div className="rounded-xl bg-card p-2.5 border border-line">
                    <span className="text-[10px] text-muted uppercase font-bold block">Distance Left</span>
                    <p className="font-display text-base font-bold text-ink mt-0.5">
                      {selectedTrip.progress?.remaining_km !== null && selectedTrip.progress?.remaining_km !== undefined
                        ? `${selectedTrip.progress.remaining_km} km`
                        : "—"}
                    </p>
                  </div>

                  <div className="rounded-xl bg-card p-2.5 border border-line">
                    <span className="text-[10px] text-muted uppercase font-bold block">Last GPS Ping</span>
                    <p className="font-mono text-[11px] font-semibold text-ink mt-1 truncate">
                      {selectedTrip.latest_fix?.recorded_at
                        ? new Date(selectedTrip.latest_fix.recorded_at).toLocaleTimeString()
                        : "No fix recorded"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Map */}
              <div className="rounded-2xl overflow-hidden border border-line shadow-sm">
                <RouteMap
                  height={380}
                  src={selectedTrip.source?.point?.coordinates}
                  dst={selectedTrip.destination?.point?.coordinates}
                  geometry={selectedTrip.route_geometry}
                  pins={pins}
                />
              </div>

              {/* Passenger Manifest */}
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-brand-teal" />
                    Confirmed Passenger Manifest ({selectedTrip.passengers.length})
                  </h4>
                </div>

                {selectedTrip.passengers.length === 0 ? (
                  <p className="text-xs text-muted">No confirmed passenger bookings on this ride.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedTrip.passengers.map((p) => (
                      <div
                        key={p.booking_id}
                        className="rounded-xl bg-card p-3 border border-line text-xs flex items-center justify-between"
                      >
                        <div>
                          <p className="font-semibold text-ink">{p.name}</p>
                          <p className="text-[11px] text-muted flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" /> {p.phone} · {p.seats} seat{p.seats > 1 ? "s" : ""}
                          </p>
                        </div>
                        <Badge variant="success" className="text-[10px]">
                          {p.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-12 text-center text-xs text-muted">
              Select an active trip from the sidebar to inspect its live vehicle location and telemetry.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
