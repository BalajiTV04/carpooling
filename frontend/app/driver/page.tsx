"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Car,
  Compass,
  Clock,
  Gauge,
  Fuel,
  PlusCircle,
  Zap,
  Calendar,
  CalendarRange,
  MapPin,
  Users,
  Shield,
  ShieldCheck,
  AlertCircle,
  LogOut,
  Menu,
  X,
  Check,
  CheckCircle2,
  Star,
  Sparkles,
  ArrowRight,
  Navigation,
  RefreshCw,
} from "lucide-react";
import { useSession } from "@/components/SessionProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { NotificationBell } from "@/components/NotificationBell";
import { ProfileSection } from "@/components/ProfileSection";
import { profileApi } from "@/lib/profile";
import { tripApi, type Trip } from "@/lib/trips";
import { vehicleApi, type Vehicle } from "@/lib/vehicles";
import { bookingApi, type Booking } from "@/lib/bookings";
import { trackingApi } from "@/lib/tracking";
import { geoApi, type PlaceHit } from "@/lib/geo";
import { PlacePicker } from "@/components/PlacePicker";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { DriverTrackingConsole } from "@/components/DriverTrackingConsole";
import { RouteSelector } from "@/components/RouteSelector";

type Section = "host" | "my-trips" | "tracking" | "requests" | "garage" | "profile";
type TripType = "live" | "monthly" | "long";

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "host", label: "Host a Trip", icon: PlusCircle },
  { id: "my-trips", label: "My Trips", icon: Clock },
  { id: "tracking", label: "Live GPS Tracking", icon: Navigation },
  { id: "requests", label: "Passenger Requests", icon: Users },
  { id: "garage", label: "Garage & Mileage", icon: Gauge },
  { id: "profile", label: "Profile", icon: ShieldCheck },
];

const PRESET_PLACES: PlaceHit[] = [
  { name: "Hebbal, Bengaluru", address: "Outer Ring Road", lat: 13.0358, lng: 77.5946 },
  { name: "Electronic City, Bengaluru", address: "Phase 1, Hosur Road", lat: 12.8452, lng: 77.67 },
  { name: "Whitefield, Bengaluru", address: "ITPL Main Road", lat: 12.9698, lng: 77.75 },
  { name: "Koramangala, Bengaluru", address: "80 Feet Road", lat: 12.9352, lng: 77.6245 },
  { name: "Indiranagar, Bengaluru", address: "100 Feet Road", lat: 12.9784, lng: 77.6408 },
  { name: "Kempegowda Int. Airport (BLR)", address: "Devanahalli", lat: 13.1986, lng: 77.7066 },
];

export default function DriverDashboardPage() {
  return (
    <RequireAuth roles={["driver"]}>
      <DriverConsoleInner />
    </RequireAuth>
  );
}

function DriverConsoleInner() {
  const { user, logout, refresh } = useSession();
  const router = useRouter();

  const [section, setSection] = React.useState<Section>("host");
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Vehicles & Trips state
  const [cars, setCars] = React.useState<Vehicle[]>([]);
  const [trips, setTrips] = React.useState<Trip[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Trip Hosting State (3 Options: Live, Monthly, Long)
  const [tripType, setTripType] = React.useState<TripType>("live");
  const [src, setSrc] = React.useState<PlaceHit | null>(PRESET_PLACES[0]);
  const [dst, setDst] = React.useState<PlaceHit | null>(PRESET_PLACES[1]);
  const [vehicleId, setVehicleId] = React.useState("");
  const [availableSeats, setAvailableSeats] = React.useState(1);

  // Departure timing based on trip type
  const [departDate, setDepartDate] = React.useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  });
  const [departTime, setDepartTime] = React.useState(() => {
    const d = new Date(Date.now() + 10 * 60_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  // Amount calculation parameters: mileage + petrol/diesel price
  const [fuelType, setFuelType] = React.useState<"petrol" | "diesel">("petrol");
  const [mileage, setMileage] = React.useState<number>(15.0);
  const [fuelPrice, setFuelPrice] = React.useState<number>(102.8);
  const [estimatedDistance, setEstimatedDistance] = React.useState<number>(25.0);
  const [busyHosting, setBusyHosting] = React.useState(false);

  // Module 26: driver-chosen route at trip creation.
  const [allRoutes, setAllRoutes] = React.useState<Array<{
    geometry: { type: string; coordinates: [number, number][] };
    distance_km?: number;
    duration_min?: number;
  }>>([]);
  const [selectedRoute, setSelectedRoute] = React.useState<{
    name: string;
    geometry: { type: string; coordinates: [number, number][] };
    distance_km?: number | null;
    duration_min?: number | null;
  } | null>(null);
  const [routeBusy, setRouteBusy] = React.useState(false);

  function fmtKm(v: number | null | undefined) { return v == null ? "—" : v.toFixed(1) + " km"; }
  function fmtMin(v: number | null | undefined) { return v == null ? "—" : v.toFixed(0) + " min"; }

  // Selected vehicle (for capacity hints in the host form)
  const selectedVehicle = cars.find((c) => c.id === vehicleId);

  // Live tracking toggle state
  const [isLiveTracking, setIsLiveTracking] = React.useState(false);
  const [incomingRequests, setIncomingRequests] = React.useState<Booking[]>([]);
  const [requestBusyId, setRequestBusyId] = React.useState<string | null>(null);
  const [broadcastingTripId, setBroadcastingTripId] = React.useState<string | null>(null);
  const [completingTripId, setCompletingTripId] = React.useState<string | null>(null);
  const [driverRating, setDriverRating] = React.useState<number | null>(null);
  const [ratingCount, setRatingCount] = React.useState<number>(0);
  const [gpsLoading, setGpsLoading] = React.useState<"src" | "dst" | null>(null);

  const handleUseLiveLocation = async (target: "src" | "dst") => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }
    setGpsLoading(target);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const rev = await geoApi.reverse(latitude, longitude);
          const hit: PlaceHit = {
            name: rev.name || `Live GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
            address: rev.address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            lat: latitude,
            lng: longitude,
          };
          if (target === "src") {
            setSrc(hit);
            setNotice(`📍 Source set to your live GPS location: ${hit.name}`);
          } else {
            setDst(hit);
            setNotice(`📍 Destination set to live GPS: ${hit.name}`);
          }
        } catch {
          const hit: PlaceHit = {
            name: `Live Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
            address: `GPS Coordinates`,
            lat: latitude,
            lng: longitude,
          };
          if (target === "src") setSrc(hit);
          else setDst(hit);
        } finally {
          setGpsLoading(null);
        }
      },
      (err) => {
        setGpsLoading(null);
        setError(`Unable to retrieve GPS location: ${err.message}`);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  // Sync mileage when user or vehicles load
  React.useEffect(() => {
    if (user?.mileage_kmpl) {
      setMileage(Number(user.mileage_kmpl));
    }
  }, [user]);

  // Load vehicles, trips, incoming requests, and driver ratings
  const loadDriverData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedTrips, fetchedVehicles, fetchedRequests, myProfile] = await Promise.all([
        tripApi.mine().catch(() => []),
        vehicleApi.list().catch(() => []),
        bookingApi.incoming().catch(() => []),
        profileApi.mine().catch(() => null),
      ]);
      setTrips(fetchedTrips);
      setIncomingRequests(Array.isArray(fetchedRequests) ? fetchedRequests : []);
      if (myProfile) {
        setDriverRating(myProfile.rating_avg ?? null);
        setRatingCount(myProfile.rating_count ?? 0);
      }

      let currentCars = fetchedVehicles;
      // Auto-provision verified car if none exists
      if (currentCars.length === 0) {
        try {
          const autoCar = await vehicleApi.create({
            make: "Primary",
            model: "Vehicle",
            year: 2022,
            color: "Silver",
            plate_no: `KA01DR${Math.floor(1000 + Math.random() * 9000)}`,
            seats_total: 4,
            fuel_type: "petrol",
            mileage_kmpl: user?.mileage_kmpl || 15.0,
          });
          currentCars = [autoCar];
        } catch {
          // ignore auto-creation error if already provisioned
        }
      }

      setCars(currentCars);
      if (currentCars.length > 0) {
        setVehicleId(currentCars[0].id);
        // Default available seats to vehicle capacity minus 1 (driver seat reserved)
        const defaultSeats = Math.max(1, (currentCars[0].seats_total || 4) - 1);
        setAvailableSeats(defaultSeats);
        if (currentCars[0].mileage_kmpl) {
          setMileage(currentCars[0].mileage_kmpl);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load driver data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    void loadDriverData();
  }, [loadDriverData]);

  const handleApproveRequest = async (bookingId: string) => {
    setRequestBusyId(bookingId);
    setError(null);
    try {
      await bookingApi.accept(bookingId);
      setNotice("✓ Passenger booking approved! The passenger can now view the vehicle live map.");
      setIncomingRequests((prev) =>
        prev.map((r) => (r.id === bookingId ? { ...r, status: "accepted" } : r))
      );
      void loadDriverData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to approve booking");
    } finally {
      setRequestBusyId(null);
    }
  };

  const handleRejectRequest = async (bookingId: string) => {
    setRequestBusyId(bookingId);
    setError(null);
    try {
      await bookingApi.reject(bookingId);
      setNotice("Passenger booking request rejected and seat released.");
      setIncomingRequests((prev) =>
        prev.map((r) => (r.id === bookingId ? { ...r, status: "rejected" } : r))
      );
      void loadDriverData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reject booking");
    } finally {
      setRequestBusyId(null);
    }
  };

  const handleBroadcastLocation = async (trip: Trip) => {
    setBroadcastingTripId(trip.id);
    setError(null);
    try {
      let lng = trip.source?.point?.coordinates?.[0] || 77.5946;
      let lat = trip.source?.point?.coordinates?.[1] || 13.0358;

      if (typeof window !== "undefined" && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3500 });
          });
          lng = pos.coords.longitude;
          lat = pos.coords.latitude;
        } catch {
          // fallback to trip coordinates
        }
      }

      await trackingApi.ping(trip.id, lng, lat, 35.0);
      setNotice(`📍 Live location broadcasted for ${trip.source_name} → ${trip.destination_name}! Approved passengers can now track this vehicle.`);
      void loadDriverData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to broadcast vehicle location");
    } finally {
      setBroadcastingTripId(null);
    }
  };

  const handleCompleteTrip = async (tripId: string) => {
    if (!confirm("Have you reached the destination? Mark this trip as completed?")) return;
    setCompletingTripId(tripId);
    setError(null);
    try {
      await tripApi.complete(tripId);
      setNotice("🏁 Trip marked as complete! Destination reached. Passengers have been notified and can now rate the trip.");
      await loadDriverData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to complete trip");
    } finally {
      setCompletingTripId(null);
    }
  };

  // Update departure timing when trip type changes
  React.useEffect(() => {
    if (tripType === "live") {
      // Live trip: Host trip for now (current date + 5-10 mins)
      const now = new Date();
      setDepartDate(now.toISOString().split("T")[0]);
      const tenMins = new Date(Date.now() + 10 * 60_000);
      setDepartTime(`${String(tenMins.getHours()).padStart(2, "0")}:${String(tenMins.getMinutes()).padStart(2, "0")}`);
    } else if (tripType === "monthly") {
      // Monthly plan: daily regular commute (e.g. 08:30 AM)
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      setDepartDate(tomorrow.toISOString().split("T")[0]);
      setDepartTime("08:30");
    } else if (tripType === "long") {
      // Long trip: 1 week before only hosting that trip
      const nextWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      setDepartDate(nextWeek.toISOString().split("T")[0]);
      setDepartTime("06:00");
    }
  }, [tripType]);

  // Recalculate distance and fetch route options when source or destination changes
  React.useEffect(() => {
    if (!src || !dst) return;
    setRouteBusy(true);
    void geoApi
      .route([src.lng, src.lat], [dst.lng, dst.lat])
      .then((res) => {
        if (res?.distance_km) {
          setEstimatedDistance(Math.round(res.distance_km * 10) / 10);
        }
        // Module 26: capture all route options for driver selection.
        if (res?.all_routes && res.all_routes.length > 0) {
          setAllRoutes(res.all_routes);
          // Default to the first (fastest) route if none selected yet.
          if (!selectedRoute) {
            setSelectedRoute({
              name: "Fastest route",
              geometry: res.all_routes[0].geometry,
              distance_km: res.all_routes[0].distance_km ?? null,
              duration_min: res.all_routes[0].duration_min ?? null,
            });
          }
        }
      })
      .catch(() => {
        // Fallback approximate Bangalore calculation
        setEstimatedDistance(26.5);
        setAllRoutes([]);
      })
      .finally(() => setRouteBusy(false));
  }, [src, dst]);

  // Fuel price defaults when fuel type changes
  React.useEffect(() => {
    if (fuelType === "petrol") {
      setFuelPrice(102.8);
    } else {
      setFuelPrice(88.9);
    }
  }, [fuelType]);

  // Calculations for Single Trip & Full Month Plan
  // Formula: Litres = Distance / Mileage; Total = Litres * Fuel Price; Per Seat = Total / Seats
  const singleTripLitres = mileage > 0 ? estimatedDistance / mileage : 0;
  const singleTripCost = Math.round(singleTripLitres * fuelPrice * 100) / 100;
  const singleTripPerSeat = availableSeats > 0 ? Math.round((singleTripCost / availableSeats) * 100) / 100 : singleTripCost;

  // Other Expenses state (Tolls, Parking, Interstate Permits, etc.)
  const [otherExpenses, setOtherExpenses] = React.useState<{ name: string; amount: number }[]>([
    { name: "Toll Charges", amount: 0 },
  ]);
  const otherExpensesTotal = otherExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const totalRequiredTripCost = Math.round((singleTripCost + otherExpensesTotal) * 100) / 100;
  const costPerSeatWithExpenses = availableSeats > 0 ? Math.round((totalRequiredTripCost / availableSeats) * 100) / 100 : totalRequiredTripCost;

  // Monthly Calculation: Full Month (30 days daily commute)
  const monthDays = 30;
  const monthlyTotalDistance = estimatedDistance * monthDays;
  const monthlyLitres = mileage > 0 ? monthlyTotalDistance / mileage : 0;
  const monthlyTotalCost = Math.round(monthlyLitres * fuelPrice * 100) / 100;
  const monthlyOtherExpenses = otherExpensesTotal * 30;
  const monthlyTotalWithExpenses = monthlyTotalCost + monthlyOtherExpenses;
  const monthlyPerSeatWithExpenses = availableSeats > 0 ? Math.round((monthlyTotalWithExpenses / availableSeats) * 100) / 100 : monthlyTotalWithExpenses;

  // Host Trip Submission
  const handleHostTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!src || !dst) {
      setError("Please select both source and destination places.");
      return;
    }
    if (!vehicleId && cars.length === 0) {
      setError("No verified vehicle available. Please check the Garage tab.");
      return;
    }
    if (!user?.phone_verified) {
      setError("Please verify your phone before hosting a trip.");
      return;
    }

    const activeVehicleId = vehicleId || cars[0]?.id;
    setBusyHosting(true);
    setError(null);
    setNotice(null);

    let createdTrip: Trip | null = null;
    try {
      const departureDateTime = new Date(`${departDate}T${departTime}:00`);
      if (Number.isNaN(departureDateTime.getTime())) {
        throw new Error("Invalid departure date or time");
      }

      // Ensure departure time is at least 2 minutes in future
      if (departureDateTime.getTime() < Date.now() + 60_000) {
        departureDateTime.setTime(Date.now() + 5 * 60_000);
      }

      // 1. Create trip with full calculations
      // Module 26: include the driver-chosen route geometry and index.
      const routeIndex = selectedRoute
        ? allRoutes.findIndex(
            (r) =>
              JSON.stringify(r.geometry.coordinates) ===
              JSON.stringify(selectedRoute.geometry.coordinates)
          )
        : -1;
      const payload = {
        vehicle_id: activeVehicleId,
        source: {
          name: src.name,
          address: src.address || null,
          coordinates: [src.lng, src.lat],
        },
        destination: {
          name: dst.name,
          address: dst.address || null,
          coordinates: [dst.lng, dst.lat],
        },
        depart_at: departureDateTime.toISOString(),
        seats_offered: availableSeats,
        trip_type: tripType,
        fuel_type: fuelType,
        fuel_price: fuelPrice,
        fuel_price_per_unit: fuelPrice,
        other_expenses: otherExpenses.filter((e) => (Number(e.amount) || 0) > 0),
        other_expenses_total: otherExpensesTotal,
        ...(selectedRoute
          ? {
              route_geometry: {
                type: "LineString",
                coordinates: selectedRoute.geometry.coordinates,
              },
              route_index: routeIndex >= 0 ? routeIndex : undefined,
            }
          : {}),
      };

      const savedTrip = await tripApi.create(payload);
      createdTrip = savedTrip;
      // Trip is saved as draft. Driver submits for admin approval separately
      // via the "Submit for Approval" button on their draft trip card.
      setTrips((prev) => [savedTrip, ...prev]);
      setNotice(
        "Trip created as draft. Submit it for admin approval from your trips list.",
      );
      setSection("my-trips");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to host trip";
      if (createdTrip) {
        const draftTrip = createdTrip;
        // Creation and submission are separate requests. Preserve a created
        // draft locally if the follow-up request fails so the driver can see
        // it instead of assuming the entire operation was rolled back.
        setTrips((prev) =>
          prev.some((trip) => trip.id === draftTrip.id)
            ? prev
            : [draftTrip, ...prev],
        );
        setSection("my-trips");
        setError(
          `Trip was created as a draft, but it could not be submitted for admin approval: ${message}`,
        );
      } else {
        setError(message);
      }
    } finally {
      setBusyHosting(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="flex min-h-screen">
        {/* Left-Side Vertical Sidebar (Same style as Admin Dashboard) */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <DriverSidebar
            active={section}
            userName={user?.full_name || user?.phone || "Driver"}
            driverRating={driverRating}
            ratingCount={ratingCount}
            onSelect={(s) => {
              setSection(s);
              setError(null);
              setNotice(null);
            }}
            onLogout={handleLogout}
          />
        </aside>

        {/* Main Content Area */}
        <div className="min-w-0 flex-1 flex flex-col">
          {/* Top Sticky Header */}
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3.5 backdrop-blur lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="rounded-xl p-2 text-muted hover:bg-card hover:text-ink lg:hidden"
                aria-label="Open driver navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">
                  Driver Workspace
                </p>
                <h1 className="font-display text-lg font-bold text-ink">
                  {NAV_ITEMS.find((item) => item.id === section)?.label}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <NotificationBell enabled={!!user} />
              <div className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-xs">
                <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                <span className="font-bold text-ink">
                  {driverRating != null ? driverRating.toFixed(1) : "5.0"}
                </span>
                <span className="text-[11px] text-muted">
                  ({ratingCount} {ratingCount === 1 ? "review" : "reviews"})
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-brand-teal animate-pulse" />
                <span className="text-muted">Status:</span>
                <span className="font-semibold text-ink">Active Driver</span>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted transition hover:bg-danger/10 hover:text-danger"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </header>

          {/* Main Work Area */}
          <main className="mx-auto max-w-7xl w-full p-4 sm:p-6 lg:p-8 flex-1">
            {error && (
              <Alert variant="danger" className="mb-5 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)}>
                  <X className="h-4 w-4" />
                </button>
              </Alert>
            )}
            {notice && (
              <Alert variant="success" className="mb-5 flex items-center justify-between">
                <span>{notice}</span>
                <button onClick={() => setNotice(null)}>
                  <X className="h-4 w-4" />
                </button>
              </Alert>
            )}

            {/* SECTION 1: HOST TRIPS (Directly gives 3 Options & Calculations) */}
            {section === "host" && (
              <div className="grid gap-6">
                {/* 3 Trip Options Header Tabs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Option 1: Live Trip */}
                  <button
                    type="button"
                    onClick={() => setTripType("live")}
                    className={`flex flex-col text-left p-4 rounded-2xl border transition relative overflow-hidden ${
                      tripType === "live"
                        ? "border-brand-teal bg-brand-teal/10 shadow-sm ring-2 ring-brand-teal/30"
                        : "border-line bg-surface hover:border-brand-teal/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="rounded-xl bg-brand-teal/20 p-2 text-brand-teal">
                        <Zap className="h-5 w-5" />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-teal/15 text-brand-teal">
                        Leaving Now
                      </span>
                    </div>
                    <p className="font-display font-bold text-ink text-base">1. Live Trip</p>
                    <p className="text-xs text-muted mt-1">
                      Host for now: where you are heading right at this moment.
                    </p>
                  </button>

                  {/* Option 2: Monthly Plan */}
                  <button
                    type="button"
                    onClick={() => setTripType("monthly")}
                    className={`flex flex-col text-left p-4 rounded-2xl border transition relative overflow-hidden ${
                      tripType === "monthly"
                        ? "border-brand-teal bg-brand-teal/10 shadow-sm ring-2 ring-brand-teal/30"
                        : "border-line bg-surface hover:border-brand-teal/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="rounded-xl bg-brand-amber/20 p-2 text-brand-amber">
                        <CalendarRange className="h-5 w-5" />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-amber/15 text-brand-amber">
                        Full Month (30d)
                      </span>
                    </div>
                    <p className="font-display font-bold text-ink text-base">2. Monthly Plan</p>
                    <p className="text-xs text-muted mt-1">
                      Same source & destination commute for the entire month.
                    </p>
                  </button>

                  {/* Option 3: Long Trip */}
                  <button
                    type="button"
                    onClick={() => setTripType("long")}
                    className={`flex flex-col text-left p-4 rounded-2xl border transition relative overflow-hidden ${
                      tripType === "long"
                        ? "border-brand-teal bg-brand-teal/10 shadow-sm ring-2 ring-brand-teal/30"
                        : "border-line bg-surface hover:border-brand-teal/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="rounded-xl bg-brand/20 p-2 text-brand">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand/15 text-brand">
                        1 Week Before
                      </span>
                    </div>
                    <p className="font-display font-bold text-ink text-base">3. Long Trip</p>
                    <p className="text-xs text-muted mt-1">
                      Intercity or advance trip hosted 1 week before departure.
                    </p>
                  </button>
                </div>

                {/* Form & Calculations Grid */}
                <form onSubmit={handleHostTrip} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: Route & Timing Inputs */}
                  <div className="lg:col-span-7 rounded-2xl border border-line bg-surface p-6 shadow-sm flex flex-col gap-5">
                    <div>
                      <h2 className="font-display font-bold text-lg text-ink">
                        {tripType === "live"
                          ? "Host Live Trip (Leaving Now)"
                          : tripType === "monthly"
                          ? "Host Monthly Commute Plan (30 Days)"
                          : "Host Long Trip (1 Week Advance)"}
                      </h2>
                      <p className="text-xs text-muted">
                        Select source, destination, and seats to instantly calculate fair fuel shares.
                      </p>
                    </div>

                    {/* Quick Preset Corridors */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold text-muted uppercase tracking-wider block">
                          Quick Pick Route or Live Location
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleUseLiveLocation("src")}
                            disabled={gpsLoading === "src"}
                            className="inline-flex items-center gap-1 rounded-lg border border-brand-teal/40 bg-brand-teal/10 px-2 py-0.5 text-[11px] font-semibold text-brand-teal hover:bg-brand-teal/20 transition disabled:opacity-60"
                          >
                            <Navigation className={`h-3 w-3 ${gpsLoading === "src" ? "animate-spin" : ""}`} />
                            {gpsLoading === "src" ? "Locating…" : "📍 Live GPS Source"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUseLiveLocation("dst")}
                            disabled={gpsLoading === "dst"}
                            className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-ink hover:border-brand-teal/40 transition disabled:opacity-60"
                          >
                            <Navigation className={`h-3 w-3 ${gpsLoading === "dst" ? "animate-spin" : ""}`} />
                            {gpsLoading === "dst" ? "Locating…" : "📍 Live GPS Drop"}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSrc(PRESET_PLACES[0]);
                            setDst(PRESET_PLACES[1]);
                          }}
                          className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs text-ink hover:border-brand-teal transition"
                        >
                          Hebbal → Electronic City
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSrc(PRESET_PLACES[3]);
                            setDst(PRESET_PLACES[2]);
                          }}
                          className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs text-ink hover:border-brand-teal transition"
                        >
                          Koramangala → Whitefield
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSrc(PRESET_PLACES[4]);
                            setDst(PRESET_PLACES[5]);
                          }}
                          className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs text-ink hover:border-brand-teal transition"
                        >
                          Indiranagar → Airport
                        </button>
                      </div>
                    </div>

                    {/* Source & Destination */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <PlacePicker label="From (Source)" value={src} onPick={setSrc} placeholder="Pickup point…" />
                      <PlacePicker label="To (Destination)" value={dst} onPick={setDst} placeholder="Drop point…" />
                    </div>

                    {/* Module 26: Route selection — driver chooses which route to travel */}
                    {allRoutes.length > 0 && (
                      <div className="mt-3">
                        <RouteSelector
                          trip={{
                            id: "new",
                            source_name: src?.name ?? "Source",
                            destination_name: dst?.name ?? "Destination",
                            source: {
                              name: src?.name ?? "Source",
                              address: null,
                              point: { type: "Point", coordinates: [src?.lng ?? 0, src?.lat ?? 0] },
                            },
                            destination: {
                              name: dst?.name ?? "Destination",
                              address: null,
                              point: { type: "Point", coordinates: [dst?.lng ?? 0, dst?.lat ?? 0] },
                            },
                            depart_at: departDate,
                            seats_offered: availableSeats,
                            seats_booked: 0,
                            seats_left: availableSeats,
                            vehicle_id: vehicleId || "",
                            status: "draft",
                            distance_km: selectedRoute?.distance_km ?? null,
                            duration_min: selectedRoute?.duration_min ?? null,
                            route_geometry: selectedRoute
                              ? { type: "LineString", coordinates: selectedRoute.geometry.coordinates }
                              : null,
                            route_alternatives: allRoutes.map((r) => ({
                              type: "LineString",
                              coordinates: r.geometry.coordinates,
                            })),
                          } as any}
                          value={selectedRoute ?? null}
                          onChange={setSelectedRoute}
                        />
                      </div>
                    )}

                    {/* Date, Time & Seats */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                          Departure Date
                        </label>
                        <input
                          type="date"
                          value={departDate}
                          onChange={(e) => setDepartDate(e.target.value)}
                          className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-teal"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                          Departure Time
                        </label>
                        <input
                          type="time"
                          value={departTime}
                          onChange={(e) => setDepartTime(e.target.value)}
                          className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-teal"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                          Seats Available
                          {selectedVehicle && (
                            <span className="text-[10px] font-normal ml-2">
                              (max {selectedVehicle.seats_total - 1} — 1 driver seat reserved)
                            </span>
                          )}
                        </label>
                        <select
                          value={availableSeats}
                          onChange={(e) => setAvailableSeats(Number(e.target.value))}
                          className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-teal"
                        >
                          {[1, 2, 3, 4, 5, 6].map((n) => {
                            const maxSeats = selectedVehicle ? Math.max(1, selectedVehicle.seats_total - 1) : 6;
                            if (n > maxSeats) return null;
                            return (
                              <option key={n} value={n}>
                                {n} passenger seat{n > 1 ? "s" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>

                    {/* Vehicle selector */}
                    <div>
                      <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                        Vehicle
                      </label>
                      <select
                        value={vehicleId}
                        onChange={(e) => {
                          setVehicleId(e.target.value);
                          const sel = cars.find((c) => c.id === e.target.value);
                          if (sel?.mileage_kmpl) setMileage(sel.mileage_kmpl);
                          // Reset available seats to vehicle capacity minus 1 (driver seat reserved)
                          if (sel?.seats_total) {
                            setAvailableSeats(Math.max(1, sel.seats_total - 1));
                          }
                        }}
                        className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-teal"
                      >
                        {cars.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.make} {c.model} · {c.plate_no} ({c.mileage_kmpl || 15} km/L · {c.seats_total} seats)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Right Column: Amount Calculation Card (Requirement) */}
                  <div className="lg:col-span-5 rounded-2xl border border-brand-teal/30 bg-gradient-to-b from-surface to-brand-teal/5 p-6 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-3 border-b border-line">
                        <div className="flex items-center gap-2">
                          <Fuel className="h-5 w-5 text-brand-teal" />
                          <h3 className="font-display font-bold text-ink">Fuel & Amount Calculation</h3>
                        </div>
                        <span className="text-[11px] font-semibold text-brand-teal bg-brand-teal/10 px-2 py-0.5 rounded-full">
                          Standard Share
                        </span>
                      </div>

                      {/* Fuel Type & Price Inputs */}
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
                            Fuel Type
                          </label>
                          <div className="grid grid-cols-2 gap-1 rounded-xl bg-card p-1 border border-line">
                            <button
                              type="button"
                              onClick={() => setFuelType("petrol")}
                              className={`py-1 text-xs font-semibold rounded-lg transition ${
                                fuelType === "petrol"
                                  ? "bg-brand-teal text-white shadow-sm"
                                  : "text-muted hover:text-ink"
                              }`}
                            >
                              Petrol
                            </button>
                            <button
                              type="button"
                              onClick={() => setFuelType("diesel")}
                              className={`py-1 text-xs font-semibold rounded-lg transition ${
                                fuelType === "diesel"
                                  ? "bg-brand-teal text-white shadow-sm"
                                  : "text-muted hover:text-ink"
                              }`}
                            >
                              Diesel
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
                            Fuel Price (₹/L)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="50"
                            max="200"
                            value={fuelPrice}
                            onChange={(e) => setFuelPrice(Number(e.target.value))}
                            className="w-full rounded-xl border border-line bg-bg px-3 py-1.5 text-sm text-ink outline-none focus:border-brand-teal"
                          />
                        </div>
                      </div>

                      {/* Mileage Input */}
                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
                          Vehicle Mileage (km/L)
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.1"
                            min="5"
                            max="50"
                            value={mileage}
                            onChange={(e) => setMileage(Number(e.target.value))}
                            className="w-full rounded-xl border border-line bg-bg pl-9 pr-3 py-1.5 text-sm text-ink outline-none focus:border-brand-teal"
                          />
                          <Gauge className="absolute left-2.5 top-2 h-4 w-4 text-muted" />
                        </div>
                        <span className="text-[10px] text-muted mt-1 block">
                          Default loaded from your registered driver profile.
                        </span>
                      </div>

                      {/* Other Expenses: Tolls, Parking, Interstate Permits (Requirement for Long Trips & Hosted Rides) */}
                      <div className="mt-4 rounded-xl border border-line bg-card/60 p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
                            <span>🎟️ Other Expenses (Tolls, Parking, Permits)</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setOtherExpenses([...otherExpenses, { name: "", amount: 0 }])}
                            className="text-[11px] font-semibold text-brand-teal hover:underline flex items-center gap-1"
                          >
                            + Add Expense
                          </button>
                        </div>
                        <p className="text-[10px] text-muted">
                          Enter toll fees, highway charges or parking to be divided among all passengers and driver.
                        </p>
                        <div className="space-y-2">
                          {otherExpenses.map((exp, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="Expense type (e.g. Highway Toll, Parking)"
                                value={exp.name}
                                onChange={(e) => {
                                  const updated = [...otherExpenses];
                                  updated[idx].name = e.target.value;
                                  setOtherExpenses(updated);
                                }}
                                className="flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand-teal"
                              />
                              <div className="relative w-28">
                                <span className="absolute left-2.5 top-1.5 text-xs text-muted">₹</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="10"
                                  placeholder="0"
                                  value={exp.amount === 0 ? "" : exp.amount}
                                  onChange={(e) => {
                                    const updated = [...otherExpenses];
                                    updated[idx].amount = Number(e.target.value) || 0;
                                    setOtherExpenses(updated);
                                  }}
                                  className="w-full rounded-xl border border-line bg-bg pl-6 pr-2 py-1.5 text-xs text-ink outline-none focus:border-brand-teal"
                                />
                              </div>
                              {otherExpenses.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setOtherExpenses(otherExpenses.filter((_, i) => i !== idx))}
                                  className="text-muted hover:text-danger px-1 text-xs"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Live Calculation Output Breakdown */}
                      <div className="mt-4 rounded-xl bg-card/80 border border-line p-3.5 space-y-2 text-xs">
                        <div className="flex justify-between text-muted">
                          <span>Route Distance:</span>
                          <span className="font-semibold text-ink">{estimatedDistance} km</span>
                        </div>
                        <div className="flex justify-between text-muted">
                          <span>Fuel Consumption:</span>
                          <span className="font-semibold text-ink">
                            {tripType === "monthly" ? `${monthlyLitres.toFixed(1)} L (30 days)` : `${singleTripLitres.toFixed(2)} L`}
                          </span>
                        </div>
                        <div className="flex justify-between text-muted">
                          <span>Base Fuel Cost:</span>
                          <span className="font-semibold text-ink">
                            ₹{singleTripCost.toFixed(2)}
                          </span>
                        </div>
                        {otherExpensesTotal > 0 && (
                          <div className="flex justify-between text-brand-amber font-semibold">
                            <span>Other Expenses (Tolls etc.):</span>
                            <span>+ ₹{otherExpensesTotal.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-muted">
                          <span>Formula:</span>
                          <span className="font-mono text-[11px] text-brand-teal">
                            (Fuel: {singleTripLitres.toFixed(1)}L × ₹{fuelPrice}) + Other: ₹{otherExpensesTotal}
                          </span>
                        </div>

                        {tripType === "monthly" ? (
                          <>
                            <div className="border-t border-line/60 pt-2 flex justify-between items-baseline">
                              <span className="font-semibold text-muted">Full Month Total (30d):</span>
                              <span className="font-display text-base font-bold text-ink">
                                ₹{monthlyTotalWithExpenses.toLocaleString()}
                              </span>
                            </div>
                            <div className="rounded-lg bg-brand-teal/15 p-2.5 flex justify-between items-center text-brand-teal">
                              <div>
                                <p className="font-bold text-sm">Monthly Pass / Rider:</p>
                                <p className="text-[10px] text-brand-teal/80">≈ ₹{(monthlyPerSeatWithExpenses / 30).toFixed(1)}/day</p>
                              </div>
                              <span className="font-display text-xl font-black">
                                ₹{monthlyPerSeatWithExpenses.toLocaleString()}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="border-t border-line/60 pt-2 flex justify-between items-baseline">
                              <span className="font-semibold text-muted">Total Required Amount:</span>
                              <span className="font-display text-base font-bold text-ink">
                                ₹{totalRequiredTripCost.toFixed(2)}
                              </span>
                            </div>
                            <div className="rounded-lg bg-brand-teal/15 p-2.5 flex justify-between items-center text-brand-teal">
                              <div>
                                <span className="font-bold text-sm block">Price per Passenger Seat:</span>
                                <span className="text-[10px] text-brand-teal/80 font-normal">
                                  ₹{totalRequiredTripCost.toFixed(2)} ÷ {availableSeats} seats
                                </span>
                              </div>
                              <span className="font-display text-xl font-black">
                                ₹{costPerSeatWithExpenses.toFixed(2)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      {/* Split-Equal Share Breakdown (driver + passengers share fuel equally) */}
                      <div className="mt-3 rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-3.5 space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-brand-teal">
                          Cost Sharing Policy: Split Equal (driver included)
                        </p>
                        {tripType === "monthly" ? (
                          <div className="text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-muted">Per Rider / Month:</span>
                              <span className="font-semibold text-ink">₹{monthlyPerSeatWithExpenses.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted">Your Share (Driver):</span>
                              <span className="font-semibold text-ink">₹{monthlyPerSeatWithExpenses.toFixed(2)} (not collected)</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-muted">Per Passenger Seat:</span>
                              <span className="font-semibold text-ink">₹{costPerSeatWithExpenses.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted">Your Share (Driver):</span>
                              <span className="font-semibold text-ink">₹{costPerSeatWithExpenses.toFixed(2)} (not collected)</span>
                            </div>
                          </div>
                        )}
                        <p className="text-[10px] text-muted">
                          Driver and each passenger pay an equal slice of fuel.{" "}
                          <b>More passengers → less each.</b> Shares recalculate automatically if someone joins mid-trip.
                        </p>
                      </div>
                    </div>

                    {selectedRoute && (
                      <div className="mt-4 rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-3.5 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-brand-teal text-[10px] uppercase tracking-wider">
                            Route to save on Host
                          </p>
                          <span className="rounded-full border border-brand-teal/50 bg-brand-teal/10 px-2 py-0.5 text-[10px] font-bold text-brand-teal">
                            SELECTED
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted">Route:</span>
                          <span className="font-semibold text-ink">{selectedRoute.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted">Distance:</span>
                          <span className="font-mono text-ink">{fmtKm(selectedRoute.distance_km)}</span>
                        </div>
                        {selectedRoute.duration_min != null && (
                          <div className="flex justify-between">
                            <span className="text-muted">Duration:</span>
                            <span className="font-mono text-ink">{fmtMin(selectedRoute.duration_min)}</span>
                          </div>
                        )}
                        <p className="text-[10px] text-muted">
                          Click below to save this route as a draft trip.
                        </p>
                      </div>
                    )}
                    <div className="mt-5">
                      <Button
                        variant="primary"
                        size="lg"
                        disabled={busyHosting || !src || !dst}
                        className="w-full flex items-center justify-center gap-2 shadow-md"
                      >
                        {busyHosting ? (
                          "Saving draft…"
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            {tripType === "live"
                              ? "Host & Save Draft (Live Trip) →"
                              : tripType === "monthly"
                              ? "Save Draft (Monthly Plan) →"
                              : "Save Draft (Long Trip) →"}
                          </>
                        )}
                      </Button>
                      <p className="text-[10px] text-muted mt-1">
                        Trip is created as a draft. Submit it for admin approval from your trips list.
                      </p>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* SECTION 2: PROFILE */}
            {section === "profile" && <ProfileSection user={user} refreshSession={refresh} />}

            {/* SECTION 3: MY TRIPS */}
            {section === "my-trips" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-lg font-bold text-ink">Hosted Trips</h2>
                    <p className="text-xs text-muted">
                      Trips you have published. Passengers can view availability and request seats.
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setSection("host")}
                    className="flex items-center gap-1.5"
                  >
                    <PlusCircle className="h-4 w-4" /> Host New Trip
                  </Button>
                </div>

                {trips.length === 0 ? (
                  <div className="rounded-2xl border border-line bg-surface p-12 text-center">
                    <Car className="mx-auto h-10 w-10 text-muted/40 mb-3" />
                    <h3 className="font-display font-bold text-ink">No hosted trips yet</h3>
                    <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                      Click the &quot;Host a Trip&quot; button to offer a Live Trip, Monthly Plan, or Long Trip.
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setSection("host")}
                      className="mt-4"
                    >
                      Host your first trip
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {trips.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-2xl border border-line bg-surface p-5 shadow-sm flex flex-col justify-between hover:border-brand-teal/40 transition"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                t.trip_type === "monthly"
                                  ? "bg-brand-amber/15 text-brand-amber"
                                  : t.trip_type === "long"
                                  ? "bg-brand/15 text-brand"
                                  : "bg-brand-teal/15 text-brand-teal"
                              }`}
                            >
                              {t.trip_type === "monthly"
                                ? "📅 Monthly Plan"
                                : t.trip_type === "long"
                                ? "🗓️ Long Trip"
                                : "⚡ Live Trip"}
                            </span>
                            <Badge variant={t.status === "published" ? "success" : t.status === "ongoing" ? "brand" : t.status === "completed" ? "success" : t.status === "rejected" ? "danger" : "muted"}>
                              {t.status === "ongoing" ? "Active / In Transit" : t.status === "completed" ? "Completed ✓" : t.status}
                            </Badge>
                          </div>

                          <div className="space-y-1 mb-3">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-brand-teal shrink-0" />
                              <p className="font-semibold text-sm text-ink truncate">
                                {t.source_name} → {t.destination_name}
                              </p>
                            </div>
                            <p className="text-xs text-muted pl-6">
                              Depart: {new Date(t.depart_at).toLocaleString("en-IN", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                          {t.status === "pending_approval" && (
                            <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
                              Awaiting admin approval. Passengers cannot book this trip yet.
                            </p>
                          )}
                          {t.status === "rejected" && (
                            <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                              Not approved{t.approval_note ? `: ${t.approval_note}` : "."}
                            </p>
                          )}

                          <div className="rounded-xl bg-card p-3 grid grid-cols-3 gap-2 text-center text-xs">
                            <div>
                              <p className="text-muted text-[10px]">Seats Left</p>
                              <p className="font-bold text-ink">
                                {t.seats_left} / {t.seats_offered}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted text-[10px]">Distance</p>
                              <p className="font-bold text-ink">{t.distance_km || "—"} km</p>
                            </div>
                            <div>
                              <p className="text-muted text-[10px]">Share / Seat</p>
                              <p className="font-bold text-brand-teal">
                                {t.cost_per_seat ? `₹${t.cost_per_seat}` : "Calculated"}
                              </p>
                            </div>
                          </div>

                          {/* Pending passenger booking requests alert on trip card */}
                          {(() => {
                            const pendingForTrip = incomingRequests.filter(
                              (r) => r.trip_id === t.id && r.status === "requested"
                            );
                            if (pendingForTrip.length === 0) return null;
                            return (
                              <div className="mt-3 rounded-xl bg-brand/10 border border-brand/30 p-2.5 flex items-center justify-between text-xs">
                                <span className="font-semibold text-brand">
                                  {pendingForTrip.length} passenger request{pendingForTrip.length > 1 ? "s" : ""} waiting
                                </span>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => setSection("requests")}
                                  className="text-xs py-1 px-2.5 h-auto shadow-sm"
                                >
                                  Approve →
                                </Button>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-muted">Trip ID: {t.id.slice(-6)}</span>

                          <div className="flex items-center gap-2">
                            {(t.status === "published" || t.status === "ongoing") && (
                              <>
                                <Button
                                  variant={t.status === "ongoing" ? "primary" : "secondary"}
                                  size="sm"
                                  onClick={() => setSection("tracking")}
                                  className="text-xs flex items-center gap-1.5 font-semibold"
                                >
                                  <Navigation className={`h-3 w-3 ${t.status === "ongoing" ? "animate-spin text-brand-teal" : ""}`} />
                                  {t.status === "ongoing" ? "Live Tracking Active →" : "Start Live Tracking →"}
                                </Button>

                                <Button
                                  variant="primary"
                                  size="sm"
                                  disabled={completingTripId === t.id}
                                  onClick={() => handleCompleteTrip(t.id)}
                                  className="text-xs flex items-center gap-1.5 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {completingTripId === t.id ? "Completing…" : "Complete Trip ✓"}
                                </Button>
                              </>
                            )}

                            {t.status === "completed" && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                Trip Completed ✓
                              </span>
                            )}

                            {t.status === "published" && (
                              <button
                                onClick={async () => {
                                  if (confirm("Cancel this trip?")) {
                                    await tripApi.cancel(t.id);
                                    setTrips((prev) =>
                                      prev.map((item) =>
                                        item.id === t.id ? { ...item, status: "cancelled" } : item
                                      )
                                    );
                                  }
                                }}
                                className="text-danger hover:underline font-medium"
                              >
                                Cancel Trip
                              </button>
                            )}
                            {t.status === "draft" && (
                              <>
                                <button
                                  onClick={async () => {
                                    if (confirm("Submit this trip for admin approval?")) {
                                      const submitted = await tripApi.submitForApproval(t.id);
                                      setTrips((prev) =>
                                        prev.map((item) =>
                                          item.id === t.id
                                            ? { ...item, status: submitted.status }
                                            : item
                                        )
                                      );
                                      setNotice("Trip submitted for admin approval.");
                                    }
                                  }}
                                  className="text-brand-teal hover:underline font-medium mr-2"
                                >
                                  Submit for Approval
                                </button>
                                <button
                                  onClick={async () => {
                                    if (confirm("Delete this draft trip?")) {
                                      await tripApi.remove(t.id);
                                      setTrips((prev) =>
                                        prev.filter((item) => item.id !== t.id)
                                      );
                                      setNotice("Draft trip deleted.");
                                    }
                                  }}
                                  className="text-rose-400 hover:underline font-medium"
                                >
                                  Delete Draft
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECTION: LIVE GPS RIDE TRACKING */}
            {section === "tracking" && (
              <DriverTrackingConsole trips={trips} onTripUpdated={loadDriverData} />
            )}

            {/* SECTION: PASSENGER REQUESTS */}
            {section === "requests" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-lg font-bold text-ink">
                      Passenger Booking Requests
                    </h2>
                    <p className="text-xs text-muted">
                      Review, approve, or reject passenger booking requests. Once approved, the passenger can see where your vehicle is on their live map.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadDriverData()}
                    className="flex items-center gap-1.5 text-xs text-muted"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </Button>
                </div>

                {incomingRequests.length === 0 ? (
                  <div className="rounded-2xl border border-line bg-surface p-12 text-center">
                    <Users className="mx-auto h-10 w-10 text-muted/40 mb-3" />
                    <h3 className="font-display font-bold text-ink">No requests yet</h3>
                    <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                      When passengers find your trip and request seats, their booking requests will appear here for your approval.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {incomingRequests.map((req) => (
                      <div
                        key={req.id}
                        className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4 flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted">Booking #{req.id.slice(-6)}</span>
                            <Badge
                              variant={
                                req.status === "accepted" || req.status === "confirmed"
                                  ? "success"
                                  : req.status === "requested"
                                  ? "brand"
                                  : "muted"
                              }
                            >
                              {req.status}
                            </Badge>
                          </div>

                          <div className="flex items-start gap-3">
                            <div className="h-9 w-9 rounded-xl bg-brand-teal/15 text-brand-teal flex items-center justify-center shrink-0">
                              <Users className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-sm text-ink truncate">
                                {req.passenger_name || "Passenger"}
                              </p>
                              <p className="text-xs text-muted">
                                Requested {req.seats} seat{req.seats > 1 ? "s" : ""}
                              </p>
                            </div>
                          </div>

                          <div className="rounded-xl bg-card p-3 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-muted">Trip:</span>
                              <span className="font-semibold text-ink truncate max-w-[200px]">
                                {req.trip?.source_name ?? "—"} → {req.trip?.destination_name ?? "—"}
                              </span>
                            </div>
                            {req.pickup?.name && (
                              <div className="flex items-center justify-between">
                                <span className="text-muted">Pickup:</span>
                                <span className="text-ink truncate max-w-[200px]">{req.pickup.name}</span>
                              </div>
                            )}
                            {req.cost_share && (
                              <div className="flex items-center justify-between">
                                <span className="text-muted">Estimated Share:</span>
                                <span className="font-bold text-brand-teal">₹{req.cost_share}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-line flex items-center justify-between gap-2">
                          {req.status === "requested" ? (
                            <>
                              <Button
                                variant="primary"
                                size="sm"
                                disabled={requestBusyId === req.id}
                                onClick={() => handleApproveRequest(req.id)}
                                className="flex-1 flex items-center justify-center gap-1"
                              >
                                <Check className="h-3.5 w-3.5" />
                                {requestBusyId === req.id ? "Approving…" : "Approve / Accept"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={requestBusyId === req.id}
                                onClick={() => handleRejectRequest(req.id)}
                                className="text-danger hover:bg-danger/10"
                              >
                                <X className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-muted">
                              Status: <strong className="text-ink">{req.status}</strong> (Vehicle tracking active for passenger)
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECTION 4: GARAGE & VEHICLE MILEAGE */}
            {section === "garage" && (
              <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm max-w-2xl space-y-6">
                <div>
                  <h2 className="font-display font-bold text-lg text-ink">Vehicle & Mileage Setup</h2>
                  <p className="text-xs text-muted">
                    Your vehicle fuel efficiency controls the cost-split formula for all trips.
                  </p>
                </div>

                {cars.map((c) => (
                  <div key={c.id} className="rounded-xl border border-line bg-card p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-brand-teal/15 p-2.5 text-brand-teal">
                          <Car className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="font-bold text-sm text-ink">{c.make} {c.model}</p>
                          <p className="text-xs text-muted">Plate: {c.plate_no} · {c.color || "Silver"}</p>
                        </div>
                      </div>
                      <Badge variant={c.verification_status === "verified" ? "success" : "muted"}>
                        {c.verification_status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs border-t border-line pt-3">
                      <div>
                        <p className="text-muted">Fuel Type</p>
                        <p className="font-semibold text-ink capitalize">{c.fuel_type}</p>
                      </div>
                      <div>
                        <p className="text-muted">Registered Mileage</p>
                        <p className="font-semibold text-brand-teal">{c.mileage_kmpl || 15} km/L</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <aside className="relative flex h-full w-80 max-w-[85vw] flex-col border-r border-line bg-surface shadow-2xl">
            <DriverSidebar
              active={section}
              userName={user?.full_name || user?.phone || "Driver"}
              driverRating={driverRating}
              ratingCount={ratingCount}
              onSelect={(s) => {
                setSection(s);
                setMobileOpen(false);
              }}
              onLogout={handleLogout}
              close={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function DriverSidebar({
  active,
  userName,
  driverRating,
  ratingCount,
  onSelect,
  onLogout,
  close,
}: {
  active: Section;
  userName: string;
  driverRating?: number | null;
  ratingCount?: number;
  onSelect: (section: Section) => void;
  onLogout: () => void;
  close?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand-teal/15 p-2 text-brand-teal">
            <Car className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display font-bold">VoltRide</p>
            <p className="text-xs text-muted">Driver Console</p>
          </div>
        </div>
        {close && (
          <button onClick={close} className="rounded-lg p-2 text-muted hover:bg-card">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1.5 px-4 py-5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                selected
                  ? "bg-brand text-white shadow-sm"
                  : "text-muted hover:bg-card hover:text-ink"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-line p-4">
        <div className="mb-3 rounded-xl bg-card px-4 py-3">
          <p className="truncate text-sm font-semibold text-ink">{userName}</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-muted">Verified Driver</p>
            {driverRating != null ? (
              <div className="flex items-center gap-1 text-xs font-bold text-amber-400">
                <Star className="h-3 w-3 fill-amber-400" />
                <span>{driverRating.toFixed(1)}</span>
                <span className="text-[10px] text-muted font-normal">({ratingCount})</span>
              </div>
            ) : (
              <span className="text-[10px] text-muted">No ratings yet</span>
            )}
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-muted transition hover:bg-danger/10 hover:text-danger"
        >
          <LogOut className="h-5 w-5" />
          Logout
        </button>
      </div>
    </>
  );
}
