"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  MapPin,
  Clock,
  UserCheck,
  Car,
  Fuel,
  Zap,
  CalendarRange,
  Calendar,
  Shield,
  LogOut,
  Menu,
  X,
  Check,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Users,
} from "lucide-react";
import { useSession } from "@/components/SessionProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { tripApi, type Trip } from "@/lib/trips";
import { bookingApi, type Booking } from "@/lib/bookings";
import { type PlaceHit } from "@/lib/geo";
import { PlacePicker } from "@/components/PlacePicker";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";

type Section = "find" | "my-rides" | "upcoming";
type TripFilter = "all" | "live" | "monthly" | "long";

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "find", label: "Find & Check Availability", icon: Search },
  { id: "my-rides", label: "My Bookings & Rides", icon: Car },
  { id: "upcoming", label: "Upcoming Trips", icon: Clock },
];

const POPULAR_DESTINATIONS: PlaceHit[] = [
  { name: "Electronic City, Bengaluru", address: "Phase 1, Hosur Road", lat: 12.8452, lng: 77.67 },
  { name: "Whitefield, Bengaluru", address: "ITPL Main Road", lat: 12.9698, lng: 77.75 },
  { name: "Hebbal, Bengaluru", address: "Outer Ring Road", lat: 13.0358, lng: 77.5946 },
  { name: "Koramangala, Bengaluru", address: "80 Feet Road", lat: 12.9352, lng: 77.6245 },
  { name: "Indiranagar, Bengaluru", address: "100 Feet Road", lat: 12.9784, lng: 77.6408 },
  { name: "Kempegowda Int. Airport (BLR)", address: "Devanahalli", lat: 13.1986, lng: 77.7066 },
];

export default function PassengerDashboardPage() {
  return (
    <RequireAuth roles={["passenger"]}>
      <PassengerConsoleInner />
    </RequireAuth>
  );
}

function PassengerConsoleInner() {
  const { user, logout } = useSession();
  const router = useRouter();

  const [section, setSection] = React.useState<Section>("find");
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Search & Destination state (requirement: show directly destination selection, then see availability)
  const [dst, setDst] = React.useState<PlaceHit | null>(POPULAR_DESTINATIONS[0]);
  const [src, setSrc] = React.useState<PlaceHit | null>(null);
  const [filterType, setFilterType] = React.useState<TripFilter>("all");
  const [seatsNeeded, setSeatsNeeded] = React.useState(1);

  // Availability & Bookings state
  const [availableTrips, setAvailableTrips] = React.useState<Trip[]>([]);
  const [myBookings, setMyBookings] = React.useState<Booking[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [loadingBookings, setLoadingBookings] = React.useState(true);
  const [bookingBusy, setBookingBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Load available trips based on destination and filter
  const checkAvailability = React.useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      const trips = await tripApi.available({
        destination: dst?.name ? dst.name.split(",")[0].trim() : undefined,
        source: src?.name ? src.name.split(",")[0].trim() : undefined,
        trip_type: filterType !== "all" ? filterType : undefined,
      });
      setAvailableTrips(trips);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to fetch available trips");
    } finally {
      setSearching(false);
    }
  }, [dst, src, filterType]);

  // Load passenger's existing bookings
  const loadBookings = React.useCallback(async () => {
    setLoadingBookings(true);
    try {
      const data = await bookingApi.mine();
      setMyBookings(Array.isArray(data) ? data : []);
    } catch {
      // fallback
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  // Initial load
  React.useEffect(() => {
    void checkAvailability();
    void loadBookings();
  }, [checkAvailability, loadBookings]);

  // Instant Book Seat Action
  const handleBookSeat = async (trip: Trip) => {
    setBookingBusy(trip.id);
    setError(null);
    setNotice(null);
    try {
      const pickupCoords: [number, number] = trip.source?.point?.coordinates || [77.5946, 13.0358];
      const dropoffCoords: [number, number] = trip.destination?.point?.coordinates || [77.67, 12.8452];

      const res = await bookingApi.create({
        trip_id: trip.id,
        seats: seatsNeeded,
        pickup_coordinates: pickupCoords,
        dropoff_coordinates: dropoffCoords,
        use_optimised_pickup: true,
      });

      setNotice(
        `✓ Seat booked successfully for ${trip.destination_name}! Status: ${res.status}. Your driver has been notified.`
      );
      // Refresh available trips and passenger bookings
      void checkAvailability();
      void loadBookings();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to book seat");
    } finally {
      setBookingBusy(null);
    }
  };

  // Cancel Booking
  const handleCancelBooking = async (bookingId: string) => {
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    try {
      await bookingApi.cancel(bookingId);
      setMyBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" } : b))
      );
      setNotice("Booking cancelled.");
      void checkAvailability();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to cancel booking");
    }
  };

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  const upcomingBookings = myBookings.filter(
    (b) => b.status === "confirmed" || b.status === "accepted" || b.status === "requested"
  );

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="flex min-h-screen">
        {/* Left-Side Vertical Sidebar (Same as Admin Dashboard) */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <PassengerSidebar
            active={section}
            userName={user?.full_name || user?.phone || "Passenger"}
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
          {/* Sticky Header Bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3.5 backdrop-blur lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="rounded-xl p-2 text-muted hover:bg-card hover:text-ink lg:hidden"
                aria-label="Open passenger navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">
                  Passenger Workspace
                </p>
                <h1 className="font-display text-lg font-bold text-ink">
                  {NAV_ITEMS.find((item) => item.id === section)?.label}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-brand-teal animate-pulse" />
                <span className="text-muted">Rider Account:</span>
                <span className="font-semibold text-ink">Active</span>
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

          {/* Main Area */}
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

            {/* SECTION 1: FIND RIDES & SEE AVAILABILITY (Show directly on login) */}
            {section === "find" && (
              <div className="space-y-6">
                {/* Destination Selector Card */}
                <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm space-y-5">
                  <div>
                    <h2 className="font-display font-bold text-lg text-ink">
                      Where are you heading?
                    </h2>
                    <p className="text-xs text-muted">
                      Select or enter your destination to view real-time available rides from verified drivers.
                    </p>
                  </div>

                  {/* Popular Quick-Tap Destinations */}
                  <div>
                    <label className="text-xs font-semibold text-muted uppercase tracking-wider block mb-2">
                      Popular Destinations (Tap to select)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {POPULAR_DESTINATIONS.map((place) => (
                        <button
                          key={place.name}
                          type="button"
                          onClick={() => setDst(place)}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition flex items-center gap-1.5 ${
                            dst?.name === place.name
                              ? "border-brand-teal bg-brand-teal/15 text-brand-teal ring-1 ring-brand-teal"
                              : "border-line bg-card text-muted hover:border-brand-teal/40 hover:text-ink"
                          }`}
                        >
                          <MapPin className="h-3.5 w-3.5 text-brand-teal" />
                          {place.name.split(",")[0]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pickers: Destination (Primary) + Source (Optional) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <PlacePicker
                      label="Enter / Select Destination (Where you want to go)"
                      value={dst}
                      onPick={setDst}
                      placeholder="Type destination, e.g. Electronic City, Whitefield…"
                    />
                    <PlacePicker
                      label="Pickup Source (Optional: specify starting point)"
                      value={src}
                      onPick={setSrc}
                      placeholder="Type pickup, e.g. Hebbal, Koramangala…"
                    />
                  </div>

                  {/* Filter Tabs: All, Live Trips (Now), Monthly Plans, Long Trips */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2 border-t border-line">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setFilterType("all")}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                          filterType === "all"
                            ? "bg-brand text-white shadow-sm"
                            : "bg-card text-muted border border-line hover:text-ink"
                        }`}
                      >
                        All Plans
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterType("live")}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition flex items-center gap-1 ${
                          filterType === "live"
                            ? "bg-brand-teal text-white shadow-sm"
                            : "bg-card text-muted border border-line hover:text-ink"
                        }`}
                      >
                        <Zap className="h-3.5 w-3.5" /> ⚡ Live Trips (Leaving Now)
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterType("monthly")}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition flex items-center gap-1 ${
                          filterType === "monthly"
                            ? "bg-brand-amber text-white shadow-sm"
                            : "bg-card text-muted border border-line hover:text-ink"
                        }`}
                      >
                        <CalendarRange className="h-3.5 w-3.5" /> 📅 Monthly Plans
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterType("long")}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition flex items-center gap-1 ${
                          filterType === "long"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "bg-card text-muted border border-line hover:text-ink"
                        }`}
                      >
                        <Calendar className="h-3.5 w-3.5" /> 🗓️ Long Trips (1 Wk Advance)
                      </button>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <div className="flex items-center gap-1 text-xs text-muted">
                        <span>Seats:</span>
                        <select
                          value={seatsNeeded}
                          onChange={(e) => setSeatsNeeded(Number(e.target.value))}
                          className="rounded-lg border border-line bg-bg px-2 py-1 text-xs text-ink outline-none"
                        >
                          {[1, 2, 3, 4].map((n) => (
                            <option key={n} value={n}>
                              {n} seat{n > 1 ? "s" : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button
                        variant="primary"
                        size="md"
                        onClick={checkAvailability}
                        disabled={searching}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Search className="h-4 w-4" />
                        {searching ? "Checking…" : "See Availability →"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Availability Results Section */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-display font-bold text-lg text-ink">
                        Available Trips ({availableTrips.length})
                      </h3>
                      <p className="text-xs text-muted">
                        Showing verified rides matching your destination.
                      </p>
                    </div>
                    {dst && (
                      <span className="text-xs text-brand-teal bg-brand-teal/10 px-3 py-1 rounded-full border border-brand-teal/20">
                        Destination: <b>{dst.name.split(",")[0]}</b>
                      </span>
                    )}
                  </div>

                  {availableTrips.length === 0 ? (
                    <div className="rounded-2xl border border-line bg-surface p-12 text-center">
                      <Car className="mx-auto h-10 w-10 text-muted/40 mb-3" />
                      <h4 className="font-display font-bold text-ink">No trips currently matching</h4>
                      <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                        No active driver has hosted a trip for this exact destination right now. You can try a popular corridor or check back in a few minutes!
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDst(POPULAR_DESTINATIONS[0]);
                          setFilterType("all");
                        }}
                        className="mt-4"
                      >
                        View all available trips
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {availableTrips.map((trip) => {
                        const isMonthly = trip.trip_type === "monthly";
                        const isLong = trip.trip_type === "long";
                        const isLive = !isMonthly && !isLong;

                        return (
                          <div
                            key={trip.id}
                            className="rounded-2xl border border-line bg-surface p-5 shadow-sm hover:border-brand-teal/40 transition flex flex-col justify-between"
                          >
                            <div>
                              {/* Header Badge */}
                              <div className="flex items-center justify-between mb-3">
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex items-center gap-1 ${
                                    isMonthly
                                      ? "bg-brand-amber/15 text-brand-amber border border-brand-amber/30"
                                      : isLong
                                      ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                                      : "bg-brand-teal/15 text-brand-teal border border-brand-teal/30"
                                  }`}
                                >
                                  {isMonthly ? (
                                    <>
                                      <CalendarRange className="h-3 w-3" /> Monthly Plan
                                    </>
                                  ) : isLong ? (
                                    <>
                                      <Calendar className="h-3 w-3" /> 1 Wk Advance
                                    </>
                                  ) : (
                                    <>
                                      <Zap className="h-3 w-3" /> Leaving Now
                                    </>
                                  )}
                                </span>

                                <span className="text-xs font-semibold text-brand-teal bg-brand-teal/10 px-2 py-0.5 rounded-md">
                                  {trip.seats_left} seats left
                                </span>
                              </div>

                              {/* Route */}
                              <div className="space-y-1.5 mb-3">
                                <div className="flex items-start gap-2">
                                  <MapPin className="h-4 w-4 text-muted mt-0.5 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-xs text-muted">From</p>
                                    <p className="text-xs font-medium text-ink truncate">{trip.source_name}</p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <MapPin className="h-4 w-4 text-brand-teal mt-0.5 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-xs text-muted">To</p>
                                    <p className="text-xs font-bold text-ink truncate">{trip.destination_name}</p>
                                  </div>
                                </div>
                              </div>

                              {/* Driver & Car Info */}
                              <div className="rounded-xl bg-card p-3 mb-3 text-xs space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted">Driver:</span>
                                  <span className="font-semibold text-ink">
                                    {trip.driver?.name || "Verified Driver"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted">Vehicle:</span>
                                  <span className="text-ink">
                                    {trip.vehicle?.make ? `${trip.vehicle.make} ${trip.vehicle.model}` : "Car"} ·{" "}
                                    <span className="font-mono text-[11px] text-muted">
                                      {trip.vehicle?.plate_no || ""}
                                    </span>
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted">Mileage & Fuel:</span>
                                  <span className="text-muted font-mono text-[11px]">
                                    {trip.vehicle?.mileage_kmpl || 15} km/L ({trip.fuel_type || "petrol"})
                                  </span>
                                </div>
                              </div>

                              {/* Departure & Distance */}
                              <div className="flex items-center justify-between text-xs text-muted mb-4 px-1">
                                <span>
                                  Departure:{" "}
                                  <b className="text-ink">
                                    {new Date(trip.depart_at).toLocaleTimeString("en-IN", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </b>
                                </span>
                                <span>{trip.distance_km || "—"} km</span>
                              </div>
                            </div>

                            {/* Price Breakdown & Book Action */}
                            <div className="border-t border-line pt-3">
                              <div className="flex items-baseline justify-between mb-3">
                                <div>
                                  <p className="text-[10px] uppercase font-semibold text-muted">
                                    {isMonthly ? "Full Month Pass" : "Calculated Share"}
                                  </p>
                                  <p className="font-display text-xl font-black text-brand-teal">
                                    {isMonthly
                                      ? `₹${(trip.monthly_cost ? Math.round(trip.monthly_cost / (trip.seats_offered || 1)) : 3600).toLocaleString()}`
                                      : trip.cost_per_seat
                                      ? `₹${trip.cost_per_seat}`
                                      : "₹150"}
                                    <span className="text-xs font-normal text-muted">
                                      {isMonthly ? " /month" : " /seat"}
                                    </span>
                                  </p>
                                </div>
                                {isMonthly && (
                                  <span className="text-[10px] text-muted text-right">
                                    ≈ ₹{Math.round((trip.monthly_cost ? trip.monthly_cost / (trip.seats_offered || 1) : 3600) / 30)}/day
                                  </span>
                                )}
                              </div>

                              <Button
                                variant="primary"
                                size="md"
                                disabled={bookingBusy === trip.id || trip.seats_left <= 0}
                                onClick={() => handleBookSeat(trip)}
                                className="w-full flex items-center justify-center gap-1.5 shadow-sm"
                              >
                                {bookingBusy === trip.id ? (
                                  "Confirming…"
                                ) : (
                                  <>
                                    <Check className="h-4 w-4" /> Book Seat Now
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 2: MY BOOKINGS & RIDES */}
            {section === "my-rides" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-lg font-bold text-ink">My Rides & Bookings</h2>
                    <p className="text-xs text-muted">
                      Your upcoming and completed carpool rides.
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setSection("find")}
                    className="flex items-center gap-1.5"
                  >
                    <Search className="h-4 w-4" /> Find Another Ride
                  </Button>
                </div>

                {myBookings.length === 0 ? (
                  <div className="rounded-2xl border border-line bg-surface p-12 text-center">
                    <Car className="mx-auto h-10 w-10 text-muted/40 mb-3" />
                    <h3 className="font-display font-bold text-ink">No bookings yet</h3>
                    <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                      You haven&apos;t booked any rides yet. Select a destination to see availability!
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setSection("find")}
                      className="mt-4"
                    >
                      Find a ride now
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {myBookings.map((b) => (
                      <div
                        key={b.id}
                        className="rounded-2xl border border-line bg-surface p-5 shadow-sm flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-muted">Booking #{b.id.slice(-6)}</span>
                            <Badge
                              variant={
                                b.status === "confirmed"
                                  ? "success"
                                  : b.status === "requested"
                                  ? "brand"
                                  : b.status === "completed"
                                  ? "muted"
                                  : "danger"
                              }
                            >
                              {b.status}
                            </Badge>
                          </div>

                          <div className="space-y-1 mb-3">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-brand-teal shrink-0" />
                              <p className="font-semibold text-sm text-ink truncate">
                                {b.trip?.source_name ?? "Source"} → {b.trip?.destination_name ?? "Destination"}
                              </p>
                            </div>
                            <p className="text-xs text-muted pl-6">
                              {b.trip?.depart_at
                                ? new Date(b.trip.depart_at).toLocaleString("en-IN", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "Scheduled Departure"}
                            </p>
                          </div>

                          <div className="rounded-xl bg-card p-3 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-muted text-[10px]">Seats Reserved</p>
                              <p className="font-bold text-ink">{b.seats} seat(s)</p>
                            </div>
                            <div>
                              <p className="text-muted text-[10px]">Cost Share</p>
                              <p className="font-bold text-brand-teal">
                                {b.cost_share ? `₹${b.cost_share}` : "Standard share"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-xs">
                          <span className="text-muted">Driver: {b.driver_name || "Assigned Driver"}</span>
                          {(b.status === "requested" || b.status === "confirmed") && (
                            <button
                              onClick={() => handleCancelBooking(b.id)}
                              className="text-danger hover:underline font-medium"
                            >
                              Cancel Booking
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECTION 3: UPCOMING TRIPS */}
            {section === "upcoming" && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">Upcoming Scheduled Trips</h2>
                  <p className="text-xs text-muted">
                    Confirmed and requested upcoming trips waiting for departure.
                  </p>
                </div>

                {upcomingBookings.length === 0 ? (
                  <div className="rounded-2xl border border-line bg-surface p-12 text-center">
                    <Clock className="mx-auto h-10 w-10 text-muted/40 mb-3" />
                    <h3 className="font-display font-bold text-ink">No upcoming trips</h3>
                    <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                      All your bookings are either completed or you haven&apos;t booked an upcoming ride yet.
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setSection("find")}
                      className="mt-4"
                    >
                      Search & book a ride
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {upcomingBookings.map((b) => (
                      <div
                        key={b.id}
                        className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="success">Confirmed Ride</Badge>
                          <span className="text-xs text-muted">{b.seats} seat(s)</span>
                        </div>
                        <p className="font-semibold text-sm text-ink">
                          {b.trip?.source_name} → {b.trip?.destination_name}
                        </p>
                        <p className="text-xs text-muted">
                          Departure:{" "}
                          {b.trip?.depart_at
                            ? new Date(b.trip.depart_at).toLocaleString("en-IN")
                            : "Scheduled"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
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
            <PassengerSidebar
              active={section}
              userName={user?.full_name || user?.phone || "Passenger"}
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

function PassengerSidebar({
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
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display font-bold">VoltRide</p>
            <p className="text-xs text-muted">Passenger Console</p>
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
          <p className="text-xs text-muted">Registered Rider</p>
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


function PassengerSidebar({
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
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display font-bold">VoltRide</p>
            <p className="text-xs text-muted">Passenger Console</p>
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
          <p className="text-xs text-muted">Registered Rider</p>
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