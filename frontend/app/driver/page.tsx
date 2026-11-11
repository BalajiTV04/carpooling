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
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { useSession } from "@/components/SessionProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { NotificationBell } from "@/components/NotificationBell";
import { ProfileSection } from "@/components/ProfileSection";
import { tripApi, type Trip } from "@/lib/trips";
import { vehicleApi, type Vehicle } from "@/lib/vehicles";
import { geoApi, type PlaceHit } from "@/lib/geo";
import { PlacePicker } from "@/components/PlacePicker";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";

type Section = "host" | "my-trips" | "tracking" | "garage" | "profile";
type TripType = "live" | "monthly" | "long";

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "host", label: "Host a Trip", icon: PlusCircle },
  { id: "my-trips", label: "My Trips", icon: Clock },
  { id: "tracking", label: "Live Tracking & Safety", icon: Compass },
  { id: "garage", label: "Garage & Mileage", icon: Gauge },
  { id: "profile", label: "Profile", icon: Users },
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

  // Selected vehicle (for capacity hints in the host form)
  const selectedVehicle = cars.find((c) => c.id === vehicleId);

  // Live tracking toggle state
  const [isLiveTracking, setIsLiveTracking] = React.useState(false);

  // Sync mileage when user or vehicles load
  React.useEffect(() => {
    if (user?.mileage_kmpl) {
      setMileage(Number(user.mileage_kmpl));
    }
  }, [user]);

  // Load vehicles and trips
  const loadDriverData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedTrips, fetchedVehicles] = await Promise.all([
        tripApi.mine().catch(() => []),
        vehicleApi.list().catch(() => []),
      ]);
      setTrips(fetchedTrips);

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

  // Recalculate distance when source or destination changes
  React.useEffect(() => {
    if (!src || !dst) return;
    void geoApi
      .route([src.lng, src.lat], [dst.lng, dst.lat])
      .then((res) => {
        if (res?.distance_km) {
          setEstimatedDistance(Math.round(res.distance_km * 10) / 10);
        }
      })
      .catch(() => {
        // Fallback approximate Bangalore calculation
        setEstimatedDistance(26.5);
      });
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

  // Monthly Calculation: Full Month (30 days daily commute)
  const monthDays = 30;
  const monthlyTotalDistance = estimatedDistance * monthDays;
  const monthlyLitres = mileage > 0 ? monthlyTotalDistance / mileage : 0;
  const monthlyTotalCost = Math.round(monthlyLitres * fuelPrice * 100) / 100;
  const monthlyPerSeat = availableSeats > 0 ? Math.round((monthlyTotalCost / availableSeats) * 100) / 100 : monthlyTotalCost;

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
      };

      createdTrip = await tripApi.create(payload);
      // 2. Every dashboard-hosted trip waits for an administrator's decision.
      // It remains invisible to passengers until the admin changes it to published.
      const submitted = await tripApi.submitForApproval(createdTrip.id);
      setTrips((prev) => [submitted, ...prev]);
      setNotice(
        `Trip submitted for admin approval. You will receive a notification when ${
          tripType === "live" ? "the live trip" : "the trip"
        } is approved.`,
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
                      <label className="text-xs font-semibold text-muted uppercase tracking-wider block mb-2">
                        Quick Pick Route
                      </label>
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
                          <span>Formula:</span>
                          <span className="font-mono text-[11px] text-brand-teal">
                            (Distance / {mileage} km/L) × ₹{fuelPrice}
                          </span>
                        </div>

                        {tripType === "monthly" ? (
                          <>
                            <div className="border-t border-line/60 pt-2 flex justify-between items-baseline">
                              <span className="font-semibold text-muted">Full Month Total (30d):</span>
                              <span className="font-display text-base font-bold text-ink">
                                ₹{monthlyTotalCost.toLocaleString()}
                              </span>
                            </div>
                            <div className="rounded-lg bg-brand-teal/15 p-2.5 flex justify-between items-center text-brand-teal">
                              <div>
                                <p className="font-bold text-sm">Monthly Pass / Rider:</p>
                                <p className="text-[10px] text-brand-teal/80">≈ ₹{(monthlyPerSeat / 30).toFixed(1)}/day</p>
                              </div>
                              <span className="font-display text-xl font-black">
                                ₹{monthlyPerSeat.toLocaleString()}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="border-t border-line/60 pt-2 flex justify-between items-baseline">
                              <span className="font-semibold text-muted">Total Trip Fuel Cost:</span>
                              <span className="font-display text-base font-bold text-ink">
                                ₹{singleTripCost.toFixed(2)}
                              </span>
                            </div>
                            <div className="rounded-lg bg-brand-teal/15 p-2.5 flex justify-between items-center text-brand-teal">
                              <span className="font-bold text-sm">Price per Passenger Seat:</span>
                              <span className="font-display text-xl font-black">
                                ₹{singleTripPerSeat.toFixed(2)}
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
                              <span className="font-semibold text-ink">₹{monthlyPerSeat.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted">Your Share (Driver):</span>
                              <span className="font-semibold text-ink">₹{monthlyPerSeat.toFixed(2)} (not collected)</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-muted">Per Passenger Seat:</span>
                              <span className="font-semibold text-ink">₹{singleTripPerSeat.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted">Your Share (Driver):</span>
                              <span className="font-semibold text-ink">₹{singleTripPerSeat.toFixed(2)} (not collected)</span>
                            </div>
                          </div>
                        )}
                        <p className="text-[10px] text-muted">
                          Driver and each passenger pay an equal slice of fuel.{" "}
                          <b>More passengers → less each.</b> Shares recalculate automatically if someone joins mid-trip.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5">
                      <Button
                        variant="primary"
                        size="lg"
                        disabled={busyHosting || !src || !dst}
                        className="w-full flex items-center justify-center gap-2 shadow-md"
                      >
                        {busyHosting ? (
                          "Publishing trip…"
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            {tripType === "live"
                              ? "Host & Broadcast Live Trip Now →"
                              : tripType === "monthly"
                              ? "Publish Monthly Commute Plan →"
                              : "Host Scheduled Long Trip →"}
                          </>
                        )}
                      </Button>
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
                            <Badge variant={t.status === "published" ? "success" : t.status === "rejected" ? "danger" : "muted"}>
                              {t.status}
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
                        </div>

                        <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-xs">
                          <span className="text-muted">Trip ID: {t.id.slice(-6)}</span>
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
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECTION 3: LIVE TRACKING & SAFETY */}
            {section === "tracking" && (
              <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm max-w-2xl space-y-6">
                <div>
                  <h2 className="font-display font-bold text-lg text-ink">Live Driver Broadcast</h2>
                  <p className="text-xs text-muted">
                    Share real-time GPS coordinates and ETA with booked passengers.
                  </p>
                </div>

                <div className="rounded-xl border border-brand-teal/20 bg-brand-teal/5 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-brand-teal/20 p-2.5 text-brand-teal">
                      <Compass className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-ink">
                        {isLiveTracking ? "Location Sharing Active" : "Location Sharing Idle"}
                      </p>
                      <p className="text-xs text-muted">
                        {isLiveTracking
                          ? "Broadcasting coordinates every 5 seconds to riders."
                          : "Not currently sharing location."}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={isLiveTracking ? "danger" : "primary"}
                    size="sm"
                    onClick={() => setIsLiveTracking(!isLiveTracking)}
                  >
                    {isLiveTracking ? "Stop Tracking" : "Start Live Tracking"}
                  </Button>
                </div>

                <div className="rounded-xl border border-line bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                    <Shield className="h-4 w-4 text-brand-teal" />
                    Safety & Emergency Controls
                  </div>
                  <p className="text-xs text-muted">
                    In case of route deviation or emergency on road, trigger immediate alerts to passenger emergency contacts and support.
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => alert("Emergency alert dispatched to response team and emergency contacts.")}
                  >
                    Emergency SOS Broadcast
                  </Button>
                </div>
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
  onSelect,
  onLogout,
  close,
}: {
  active: Section;
  userName: string;
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
          <p className="text-xs text-muted">Verified Driver</p>
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
