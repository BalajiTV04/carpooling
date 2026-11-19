"use client";

import * as React from "react";
import { trackingApi, type LiveFix } from "@/lib/tracking";
import { tripApi, type Trip } from "@/lib/trips";
import { RouteMap, type MapPin } from "@/components/RouteMap";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import {
  Navigation,
  MapPin as MapPinIcon,
  Wifi,
  WifiOff,
  Compass,
  Gauge,
  ShieldCheck,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  Info,
  Smartphone,
  BatteryCharging,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface DriverTrackingConsoleProps {
  trips: Trip[];
  onTripUpdated?: () => void;
}

export function DriverTrackingConsole({ trips, onTripUpdated }: DriverTrackingConsoleProps) {
  // Candidate trips for live tracking (published or ongoing)
  const trackableTrips = trips.filter(
    (t) => t.status === "published" || t.status === "ongoing"
  );

  const [selectedTripId, setSelectedTripId] = React.useState<string>(
    () => trackableTrips.find((t) => t.status === "ongoing")?.id || trackableTrips[0]?.id || ""
  );

  // Sync selected trip if list changes or selectedTripId is not in trackableTrips
  React.useEffect(() => {
    if (trackableTrips.length > 0) {
      const exists = trackableTrips.some((t) => t.id === selectedTripId);
      if (!exists) {
        setSelectedTripId(trackableTrips.find((t) => t.status === "ongoing")?.id || trackableTrips[0].id);
      }
    } else if (selectedTripId) {
      setSelectedTripId("");
    }
  }, [trackableTrips, selectedTripId]);

  const activeTrip = trips.find((t) => t.id === selectedTripId);

  // Device & Permission states
  const [permissionStatus, setPermissionStatus] = React.useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [gpsAvailable, setGpsAvailable] = React.useState<boolean>(true);
  const [isOnline, setIsOnline] = React.useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isTracking, setIsTracking] = React.useState<boolean>(activeTrip?.status === "ongoing");
  const [watchId, setWatchId] = React.useState<number | null>(null);

  // Telemetry & metrics
  const [currentCoords, setCurrentCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [currentSpeed, setCurrentSpeed] = React.useState<number | null>(null);
  const [accuracy, setAccuracy] = React.useState<number | null>(null);
  const [heading, setHeading] = React.useState<number | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = React.useState<Date | null>(null);
  const [progress, setProgress] = React.useState<LiveFix["progress"] | null>(null);
  const [pushedCount, setPushedCount] = React.useState<number>(0);

  // UI state
  const [busyAction, setBusyAction] = React.useState<"starting" | "stopping" | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  // Last sent position reference for distance/time throttling
  const lastSentRef = React.useRef<{ lat: number; lng: number; time: number } | null>(null);

  // Monitor Network Connectivity
  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Check Geolocation Permission
  React.useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGpsAvailable(false);
      setPermissionStatus("denied");
      return;
    }

    setGpsAvailable(true);

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((permission) => {
          setPermissionStatus(permission.state as "granted" | "denied" | "prompt");
          permission.onchange = () => {
            setPermissionStatus(permission.state as "granted" | "denied" | "prompt");
          };
        })
        .catch(() => {
          setPermissionStatus("prompt");
        });
    }
  }, []);

  // Update tracking active state if activeTrip status changes
  React.useEffect(() => {
    if (activeTrip?.status === "ongoing" && !isTracking) {
      // Trip is marked ongoing in backend
    }
  }, [activeTrip?.status, isTracking]);

  // Cleanup watchPosition on unmount
  React.useEffect(() => {
    return () => {
      if (watchId !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [watchId]);

  // Haversine distance in meters for local distance throttling
  const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Transmit GPS Fix to Backend
  const transmitLocation = React.useCallback(
    async (pos: GeolocationPosition, tripId: string) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      const head = pos.coords.heading;
      let spd = pos.coords.speed !== null && pos.coords.speed !== undefined ? pos.coords.speed * 3.6 : null; // m/s to km/h

      const now = Date.now();
      const last = lastSentRef.current;

      // Throttle: Send if first fix, or moved >= 5m, or > 4 seconds elapsed
      if (last) {
        const dist = haversineMeters(last.lat, last.lng, lat, lng);
        const timeDiff = (now - last.time) / 1000;

        // Compute speed from delta if browser did not provide pos.coords.speed
        if (spd === null && timeDiff > 0 && dist > 0) {
          const derivedSpeed = (dist / timeDiff) * 3.6;
          if (derivedSpeed < 180) {
            spd = Math.round(derivedSpeed * 10) / 10;
          }
        }

        if (dist < 5 && timeDiff < 4) {
          // Skip redundant stationary update
          setCurrentCoords({ lat, lng });
          setAccuracy(Math.round(acc));
          return;
        }
      }

      try {
        const res = await trackingApi.location(tripId, lng, lat, spd, acc, head);
        setCurrentCoords({ lat, lng });
        setCurrentSpeed(spd !== null ? Math.round(spd) : null);
        setAccuracy(Math.round(acc));
        setHeading(head !== null ? Math.round(head) : null);
        setLastUpdateTime(new Date());
        if (res.progress) setProgress(res.progress);
        if (res.pushed_to !== undefined) setPushedCount(res.pushed_to);
        setErrorMsg(null);
        lastSentRef.current = { lat, lng, time: now };
      } catch (err) {
        if (!navigator.onLine) {
          setErrorMsg("Device is offline. Location update will retry when connection restores.");
        } else {
          setErrorMsg(err instanceof Error ? err.message : "Failed to send GPS update");
        }
      }
    },
    []
  );

  // START RIDE WORKFLOW
  const handleStartRide = async () => {
    if (!selectedTripId) {
      setErrorMsg("Please select a trip to track.");
      return;
    }

    if (!isOnline) {
      setErrorMsg("Cannot start tracking while offline. Please connect to internet.");
      return;
    }

    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setErrorMsg("Geolocation is not supported by your browser/device.");
      return;
    }

    setBusyAction("starting");
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Initial Device GPS Verification
      const initialPos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });

      setPermissionStatus("granted");
      setGpsAvailable(true);

      // 2. Notify backend to start tracking and transition trip to ongoing
      const startRes = await trackingApi.start(selectedTripId);
      setIsTracking(true);
      setSuccessMsg(`🚀 Ride tracking started! ${startRes.message}`);

      // 3. Send initial location fix
      await transmitLocation(initialPos, selectedTripId);

      // 4. Start continuous GPS watch
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          void transmitLocation(pos, selectedTripId);
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setPermissionStatus("denied");
            setErrorMsg("Location permission denied. Please allow location access in your browser settings.");
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            setGpsAvailable(false);
            setErrorMsg("GPS position unavailable. Please ensure GPS/Location is enabled in your device settings.");
          } else if (err.code === err.TIMEOUT) {
            setErrorMsg("GPS request timed out. Retrying…");
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 2000,
          timeout: 12000,
        }
      );

      setWatchId(id);
      onTripUpdated?.();
    } catch (err: any) {
      if (err?.code === 1) {
        setPermissionStatus("denied");
        setErrorMsg("Location permission denied. Please grant location permissions to start your ride.");
      } else if (err?.code === 2) {
        setGpsAvailable(false);
        setErrorMsg("GPS is unavailable. Please turn on Location in your device settings.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Failed to start ride tracking");
      }
    } finally {
      setBusyAction(null);
    }
  };

  // END RIDE WORKFLOW
  const handleEndRide = async () => {
    if (!selectedTripId) return;

    if (!confirm("Are you sure you want to end this ride and stop live tracking?")) {
      return;
    }

    setBusyAction("stopping");
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Clear device watch
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        setWatchId(null);
      }

      // 2. Notify backend to stop tracking & complete trip
      const stopRes = await trackingApi.stop(selectedTripId);
      setIsTracking(false);
      setSuccessMsg(`🏁 Ride completed. ${stopRes.message}`);
      lastSentRef.current = null;
      onTripUpdated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to stop ride tracking");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 rounded-full bg-brand-teal animate-pulse" />
              <h2 className="font-display font-bold text-xl text-ink">
                Live GPS Ride Tracking
              </h2>
            </div>
            <p className="text-xs text-muted mt-1">
              Uber/Ola-style real-time device GPS broadcasting. Passengers and administrators track your vehicle live on the map.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 ${
                isTracking
                  ? "bg-brand-teal/15 text-brand-teal border border-brand-teal/30 ring-1 ring-brand-teal/30"
                  : "bg-card text-muted border border-line"
              }`}
            >
              <Navigation className={`h-3.5 w-3.5 ${isTracking ? "animate-spin text-brand-teal" : ""}`} />
              {isTracking ? "Tracking: ACTIVE" : "Tracking: INACTIVE"}
            </span>
          </div>
        </div>

        {/* Status Pills Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-line">
          {/* Permission Status */}
          <div className="rounded-xl bg-card p-3 border border-line">
            <span className="text-[10px] uppercase font-bold text-muted block mb-1">
              Location Permission
            </span>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {permissionStatus === "granted" ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-brand-teal" />
                  <span className="text-brand-teal">Granted</span>
                </>
              ) : permissionStatus === "denied" ? (
                <>
                  <XCircle className="h-4 w-4 text-danger" />
                  <span className="text-danger">Denied</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-brand-amber" />
                  <span className="text-brand-amber">Not Requested</span>
                </>
              )}
            </div>
          </div>

          {/* GPS Availability */}
          <div className="rounded-xl bg-card p-3 border border-line">
            <span className="text-[10px] uppercase font-bold text-muted block mb-1">
              GPS Hardware
            </span>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {gpsAvailable ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-brand-teal" />
                  <span className="text-brand-teal">Available</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-danger" />
                  <span className="text-danger">Unavailable</span>
                </>
              )}
            </div>
          </div>

          {/* Internet Connection */}
          <div className="rounded-xl bg-card p-3 border border-line">
            <span className="text-[10px] uppercase font-bold text-muted block mb-1">
              Internet Connection
            </span>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {isOnline ? (
                <>
                  <Wifi className="h-4 w-4 text-brand-teal" />
                  <span className="text-brand-teal">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-danger" />
                  <span className="text-danger">Offline</span>
                </>
              )}
            </div>
          </div>

          {/* Live Watchers */}
          <div className="rounded-xl bg-card p-3 border border-line">
            <span className="text-[10px] uppercase font-bold text-muted block mb-1">
              Audience Watchers
            </span>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <ShieldCheck className="h-4 w-4 text-brand" />
              <span className="text-ink">
                {pushedCount} watcher{pushedCount === 1 ? "" : "s"} live
              </span>
            </div>
          </div>
        </div>

        {/* Mobile Background Tracking Notice */}
        <div className="mt-4 rounded-xl bg-brand/10 border border-brand/20 p-3.5 flex items-start gap-3">
          <Smartphone className="h-5 w-5 text-brand shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-ink">
              Mobile Browser Tracking Advisory:
            </p>
            <p className="text-muted leading-relaxed">
              Mobile browsers (Chrome & Safari) automatically throttle or suspend GPS background updates when the screen is locked or browser is minimized.
              <strong> Keep this tab open and your screen unlocked</strong> while driving for uninterrupted live passenger tracking.
              <span className="block text-[11px] text-brand mt-0.5">
                ✦ Future native Android integration will run as a persistent Foreground Location Service with FusedLocationProvider.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <Alert variant="danger" className="flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-danger hover:opacity-80">
            ×
          </button>
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" className="flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-brand-teal hover:opacity-80">
            ×
          </button>
        </Alert>
      )}

      {/* Trip Selection & Controls */}
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted block mb-1">
              Select Trip for Real-Time Tracking
            </label>
            {trackableTrips.length === 0 ? (
              <p className="text-xs text-warn">
                No active or published trips found. Please publish or host a trip first.
              </p>
            ) : (
              <select
                value={selectedTripId}
                onChange={(e) => setSelectedTripId(e.target.value)}
                disabled={isTracking}
                className="w-full sm:w-80 rounded-xl border border-line bg-card px-3 py-2 text-xs font-medium text-ink outline-none focus:border-brand-teal"
              >
                {trackableTrips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.source_name} → {t.destination_name} ({t.status.toUpperCase()})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!isTracking ? (
              <Button
                variant="primary"
                size="md"
                disabled={busyAction !== null || trackableTrips.length === 0}
                onClick={handleStartRide}
                className="flex items-center gap-2 shadow-sm font-semibold"
              >
                <Play className="h-4 w-4 fill-white" />
                {busyAction === "starting" ? "Acquiring GPS…" : "Start Ride & Track"}
              </Button>
            ) : (
              <Button
                variant="danger"
                size="md"
                disabled={busyAction !== null}
                onClick={handleEndRide}
                className="flex items-center gap-2 shadow-sm font-semibold"
              >
                <Square className="h-4 w-4 fill-white" />
                {busyAction === "stopping" ? "Ending Ride…" : "End Ride & Stop"}
              </Button>
            )}
          </div>
        </div>

        {/* Live GPS Telemetry Dashboard */}
        {activeTrip && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-line">
            <div className="rounded-xl bg-card p-3 border border-line">
              <span className="text-[10px] text-muted uppercase font-bold flex items-center gap-1">
                <MapPinIcon className="h-3 w-3 text-brand-teal" /> Current GPS
              </span>
              <p className="font-mono text-xs font-semibold text-ink mt-1 truncate">
                {currentCoords
                  ? `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}`
                  : "Awaiting GPS Fix"}
              </p>
              {accuracy !== null && (
                <span className="text-[10px] text-muted">
                  Accuracy: ±{accuracy}m
                </span>
              )}
            </div>

            <div className="rounded-xl bg-card p-3 border border-line">
              <span className="text-[10px] text-muted uppercase font-bold flex items-center gap-1">
                <Gauge className="h-3 w-3 text-brand-teal" /> Live Speed
              </span>
              <p className="font-display text-lg font-bold text-ink mt-0.5">
                {currentSpeed !== null ? `${currentSpeed} km/h` : "0 km/h"}
              </p>
              <span className="text-[10px] text-muted">
                {heading !== null ? `Heading: ${heading}°` : "Heading: —"}
              </span>
            </div>

            <div className="rounded-xl bg-card p-3 border border-line">
              <span className="text-[10px] text-muted uppercase font-bold flex items-center gap-1">
                <Navigation className="h-3 w-3 text-brand-teal" /> Route Progress
              </span>
              <p className="font-display text-lg font-bold text-brand-teal mt-0.5">
                {progress?.frac !== undefined && progress.frac !== null
                  ? `${Math.round(progress.frac * 100)}%`
                  : "0%"}
              </p>
              <span className="text-[10px] text-muted">
                {progress?.remaining_km !== undefined && progress.remaining_km !== null
                  ? `${progress.remaining_km} km remaining`
                  : "Calculating…"}
              </span>
            </div>

            <div className="rounded-xl bg-card p-3 border border-line">
              <span className="text-[10px] text-muted uppercase font-bold flex items-center gap-1">
                <RefreshCw className="h-3 w-3 text-brand-teal" /> Last Update
              </span>
              <p className="text-xs font-medium text-ink mt-1">
                {lastUpdateTime
                  ? lastUpdateTime.toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "Not started"}
              </p>
              <span className="text-[10px] text-muted">
                {isTracking ? "Live polling & push" : "Inactive"}
              </span>
            </div>
          </div>
        )}

        {/* Live Route Map with Moving Vehicle Marker */}
        {activeTrip && (
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                Driver Navigation & Corridor Map
              </h4>
              {progress?.off_route && (
                <span className="text-xs text-danger font-semibold bg-danger/10 px-2.5 py-0.5 rounded-full border border-danger/20 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Route Deviation Detected ({progress.off_route_m}m)
                </span>
              )}
            </div>
            <div className="rounded-xl overflow-hidden border border-line">
              <RouteMap
                height={320}
                src={activeTrip.source?.point?.coordinates}
                dst={activeTrip.destination?.point?.coordinates}
                geometry={activeTrip.route_geometry}
                pins={
                  currentCoords
                    ? [
                        {
                          lat: currentCoords.lat,
                          lng: currentCoords.lng,
                          label: "Your Vehicle (Driver)",
                          color: "#14b8a6",
                          iconType: "car",
                          heading: heading ?? 0,
                          speed_kmph: currentSpeed,
                          plateNo: typeof activeTrip.vehicle === "string" ? activeTrip.vehicle : activeTrip.vehicle?.plate_no || "DRIVER",
                          driverName: "You (Driver)",
                          isSelected: true,
                        },
                      ]
                    : []
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
