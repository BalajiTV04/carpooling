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
  Star,
  Sparkles,
  ArrowRight,
  Users,
  Navigation,
} from "lucide-react";
import { useSession } from "@/components/SessionProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { ProfileSection } from "@/components/ProfileSection";
import { SafetyBanner } from "@/components/SafetyBanner";
import { tripApi, type Trip } from "@/lib/trips";
import { bookingApi, type Booking } from "@/lib/bookings";
import { ratingApi } from "@/lib/ratings";
import { safetyApi } from "@/lib/safety";
import { authApi } from "@/lib/auth";
import { geoApi, type PlaceHit } from "@/lib/geo";
import { PlacePicker } from "@/components/PlacePicker";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { VehicleTrackingCard } from "@/components/VehicleTrackingCard";

type Section = "find" | "my-rides" | "upcoming" | "profile";
type TripFilter = "all" | "live" | "monthly" | "long";

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "find", label: "Find & Check Availability", icon: Search },
  { id: "my-rides", label: "My Bookings & Rides", icon: Car },
  { id: "upcoming", label: "Upcoming Trips", icon: Clock },
  { id: "profile", label: "Profile", icon: Users },
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
  const { user, logout, refresh } = useSession();
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
  const [gpsLoading, setGpsLoading] = React.useState<"src" | "dst" | null>(null);

  // Requirement: show all matching trips; if all seats booked, show as "Seat Over" badge
  const visibleAvailableTrips = availableTrips;

  // Live GPS locator for Destination and Source
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
          if (target === "dst") {
            setDst(hit);
            setNotice(`📍 Destination set to live GPS: ${hit.name}`);
          } else {
            setSrc(hit);
            setNotice(`📍 Pickup source set to live GPS: ${hit.name}`);
          }
        } catch {
          const hit: PlaceHit = {
            name: `Live Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
            address: `GPS Coordinates`,
            lat: latitude,
            lng: longitude,
          };
          if (target === "dst") setDst(hit);
          else setSrc(hit);
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

  // Load available trips based on destination and filter
  const checkAvailability = React.useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      const trips = await tripApi.available({
        destination: dst?.name ? dst.name.split(",")[0].trim() : undefined,
        source: src?.name ? src.name.split(",")[0].trim() : undefined,
        trip_type: filterType !== "all" ? filterType : undefined,
        dst_lat: dst?.lat,
        dst_lng: dst?.lng,
        src_lat: src?.lat,
        src_lng: src?.lng,
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
      const pickupCoords: [number, number] =
        src?.lng != null && src?.lat != null
          ? [src.lng, src.lat]
          : trip.pickup?.coordinates
          ? trip.pickup.coordinates
          : trip.pickup?.lng != null && trip.pickup?.lat != null
          ? [trip.pickup.lng, trip.pickup.lat]
          : (trip.source?.point?.coordinates as [number, number]) || [77.5946, 13.0358];
      const dropoffCoords: [number, number] =
        dst?.lng != null && dst?.lat != null
          ? [dst.lng, dst.lat]
          : trip.drop?.coordinates
          ? trip.drop.coordinates
          : trip.drop?.lng != null && trip.drop?.lat != null
          ? [trip.drop.lng, trip.drop.lat]
          : (trip.destination?.point?.coordinates as [number, number]) || [77.67, 12.8452];

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

  const handleLogout = async () => {
    // Invalidate the session on the backend (best effort; clear local state regardless).
    try {
      await authApi.logout();
    } catch {
      /* backend unreachable — still clear local session below */
    }
    logout();
    router.replace("/login");
  };

  const upcomingBookings = myBookings.filter(
    (b) => b.status === "confirmed" || b.status === "accepted" || b.status === "requested"
  );

  const approvedBookings = myBookings.filter(
    (b) => b.status === "accepted" || b.status === "confirmed"
  );

  const completedBookings = myBookings.filter(
    (b) => b.status === "completed"
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

            {/* Live Vehicle Tracking Banner when Trip is Booked & Approved */}
            {approvedBookings.length > 0 && (
              <div className="mb-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-teal animate-pulse" />
                    <h2 className="font-display text-sm font-bold uppercase tracking-wider text-brand-teal">
                      Your Booked Trip is Approved · Live Vehicle Tracking
                    </h2>
                  </div>
                  <Badge variant="success" className="text-xs">
                    {approvedBookings.length} Approved Trip{approvedBookings.length > 1 ? "s" : ""}
                  </Badge>
                </div>
                {approvedBookings.map((b) => (
                  <VehicleTrackingCard
                    key={b.id}
                    booking={b}
                    title={`Vehicle Location: ${b.trip?.source_name ?? "Origin"} → ${b.trip?.destination_name ?? "Destination"}`}
                    defaultExpanded={true}
                  />
                ))}
              </div>
            )}

            {/* Completed Rides & Rating Banner */}
            {completedBookings.length > 0 && (
              <div className="mb-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <h2 className="font-display text-sm font-bold uppercase tracking-wider text-emerald-400">
                      Completed Trips · Rate Your Driver
                    </h2>
                  </div>
                  <Badge variant="success" className="text-xs">
                    {completedBookings.length} Completed Ride{completedBookings.length > 1 ? "s" : ""}
                  </Badge>
                </div>
                {completedBookings.map((b) => (
                  <CompletedRideCard
                    key={b.id}
                    booking={b}
                    onRatingSubmitted={() => void loadBookings()}
                  />
                ))}
              </div>
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
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Choose Location or Use Live GPS</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleUseLiveLocation("dst")}
                          disabled={gpsLoading === "dst"}
                          className="inline-flex items-center gap-1 rounded-lg border border-brand-teal/40 bg-brand-teal/10 px-2 py-1 text-[11px] font-semibold text-brand-teal hover:bg-brand-teal/20 transition disabled:opacity-60"
                        >
                          <Navigation className={`h-3 w-3 ${gpsLoading === "dst" ? "animate-spin" : ""}`} />
                          {gpsLoading === "dst" ? "Locating…" : "📍 Live GPS Destination"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUseLiveLocation("src")}
                          disabled={gpsLoading === "src"}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink hover:border-brand-teal/40 transition disabled:opacity-60"
                        >
                          <Navigation className={`h-3 w-3 ${gpsLoading === "src" ? "animate-spin" : ""}`} />
                          {gpsLoading === "src" ? "Locating…" : "📍 Live GPS Pickup"}
                        </button>
                      </div>
                    </div>

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
                        Available Trips ({visibleAvailableTrips.length})
                      </h3>
                      <p className="text-xs text-muted">
                        Showing verified rides with open seats matching your destination.
                      </p>
                    </div>
                    {dst && (
                      <span className="text-xs text-brand-teal bg-brand-teal/10 px-3 py-1 rounded-full border border-brand-teal/20">
                        Destination: <b>{dst.name.split(",")[0]}</b>
                      </span>
                    )}
                  </div>

                  {visibleAvailableTrips.length === 0 ? (
                    <div className="rounded-2xl border border-line bg-surface p-12 text-center">
                      <Car className="mx-auto h-10 w-10 text-muted/40 mb-3" />
                      <h4 className="font-display font-bold text-ink">No open trips available right now</h4>
                      <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                        Either no driver has hosted a trip for this route or seats are completely booked. Check your booked trips in the dashboard!
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDst(null);
                          setSrc(null);
                          setFilterType("all");
                        }}
                        className="mt-4"
                      >
                        View all available trips
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {visibleAvailableTrips.map((trip) => {
                        const isMonthly = trip.trip_type === "monthly";
                        const isLong = trip.trip_type === "long";
                        const isLive = !isMonthly && !isLong;
                        const isSoldOut = trip.is_sold_out || (trip.seats_left ?? 0) <= 0;

                        return (
                          <div
                            key={trip.id}
                            className={`rounded-2xl border bg-surface p-5 shadow-sm transition flex flex-col justify-between ${
                              isSoldOut ? "border-rose-500/30 opacity-90" : "border-line hover:border-brand-teal/40"
                            }`}
                          >
                            <div>
                              {/* Header Badge */}
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
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

                                  {trip.status === "ongoing" && (
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" /> Active
                                    </span>
                                  )}
                                </div>

                                {isSoldOut ? (
                                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center gap-1">
                                    Seat Over (Sold Out)
                                  </span>
                                ) : (
                                  <span className="text-xs font-semibold text-brand-teal bg-brand-teal/10 px-2 py-0.5 rounded-md">
                                    {trip.seats_left} seats left
                                  </span>
                                )}
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

                              {/* Corridor & Pickup Match Info */}
                              {trip.passenger_distance_km != null && (
                                <div className="mb-3 rounded-xl bg-brand-teal/10 border border-brand-teal/20 p-2.5 text-xs text-brand-teal space-y-1">
                                  <div className="flex items-center justify-between font-semibold">
                                    <span className="flex items-center gap-1">
                                      <Sparkles className="h-3.5 w-3.5" /> Route Corridor Match
                                    </span>
                                    <span>
                                      {trip.detour_km != null && trip.detour_km <= 0.05
                                        ? "On Route (0 km detour)"
                                        : `+${trip.detour_km} km detour`}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] text-muted">
                                    <span>Your Distance:</span>
                                    <span className="font-semibold text-ink">
                                      {trip.passenger_distance_km} km{" "}
                                      <span className="text-[10px] text-muted font-normal">
                                        (Driver total: {trip.distance_km} km)
                                      </span>
                                    </span>
                                  </div>
                                  {trip.pickup?.label && (
                                    <div className="text-[11px] text-ink font-medium truncate pt-0.5 border-t border-brand-teal/15">
                                      📍 Pickup: {trip.pickup.label}
                                      {trip.pickup.walk_km != null && trip.pickup.walk_km > 0
                                        ? ` (${Math.round(trip.pickup.walk_km * 1000)}m walk)`
                                        : ""}
                                    </div>
                                  )}
                                </div>
                              )}

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
                              {trip.distance_km && trip.cost_per_seat && trip.seats_offered && (
                                <div className="flex items-center justify-between text-xs text-muted mt-1 px-1">
                                  <span>
                                    Total Trip Cost:
                                  </span>
                                  <span className="font-semibold text-ink">
                                    ₹{(trip.cost_per_seat * trip.seats_offered).toFixed(0)}
                                  </span>
                                </div>
                              )}
                              {trip.other_expenses_total != null && trip.other_expenses_total > 0 && (
                                <div className="flex items-center justify-between text-xs text-brand-amber mt-1 px-1 font-medium">
                                  <span>Includes Other Expenses (Tolls, etc.):</span>
                                  <span>+₹{trip.other_expenses_total}</span>
                                </div>
                              )}
                              {trip.distance_km && trip.cost_per_seat && trip.seats_offered && (
                                <div className="flex items-center justify-between text-xs text-muted mt-1 px-1">
                                  <span>
                                    Price per km:
                                  </span>
                                  <span className="font-semibold text-brand-teal">
                                    ₹{(((trip.cost_per_seat * trip.seats_offered) / trip.distance_km) * 100) / 100}/km
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Price Breakdown & Book Action */}
                            <div className="border-t border-line pt-3">
                              <div className="flex items-baseline justify-between mb-3">
                                <div>
                                  <p className="text-[10px] uppercase font-semibold text-muted">
                                    {isMonthly
                                      ? "Full Month Pass"
                                      : trip.estimated_contribution
                                      ? "Estimated Contribution"
                                      : "Calculated Share"}
                                  </p>
                                  <p className="font-display text-xl font-black text-brand-teal">
                                    {isMonthly
                                      ? `₹${(trip.monthly_cost ? Math.round(trip.monthly_cost / (trip.seats_offered || 1)) : 3600).toLocaleString()}`
                                      : trip.estimated_contribution != null
                                      ? `₹${trip.estimated_contribution}`
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

                              {isSoldOut ? (
                                <Button
                                  variant="secondary"
                                  size="md"
                                  disabled={true}
                                  className="w-full flex items-center justify-center gap-1.5 opacity-70 cursor-not-allowed border-rose-500/30 text-rose-400 bg-rose-500/10 font-bold"
                                >
                                  Seat Over (0 Seats Left)
                                </Button>
                              ) : (
                                <Button
                                  variant="primary"
                                  size="md"
                                  disabled={bookingBusy === trip.id || (trip.seats_left ?? 0) <= 0}
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
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 2: PROFILE */}
            {section === "profile" && <ProfileSection user={user} refreshSession={refresh} />}

            {/* SECTION 3: MY BOOKINGS & RIDES */}
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
                              <div className="flex items-center gap-1.5">
                                {b.fare_changed && b.previous_amount != null && b.cost_share != null && b.previous_amount !== b.cost_share && (
                                  <span className="text-xs line-through text-muted font-medium">
                                    ₹{Math.round(b.previous_amount)}
                                  </span>
                                )}
                                <p className="font-bold text-brand-teal">
                                  {b.cost_share ? `₹${b.cost_share}` : "Standard share"}
                                </p>
                              </div>
                            </div>
                          </div>
                          {b.fare_changed && b.previous_amount != null && b.cost_share != null && (
                            <div className="mt-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-400 flex items-center gap-2">
                              <span>🎉</span>
                              <span>
                                Fare reduced from <span className="line-through text-muted">₹{Math.round(b.previous_amount)}</span> to <b>₹{Math.round(b.cost_share)}</b> because another passenger joined your shared route!
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Approved Ride Live Vehicle Tracking Map */}
                        {(b.status === "accepted" || b.status === "confirmed") ? (
                          <div className="mt-4 pt-3 border-t border-line">
                            <VehicleTrackingCard
                              booking={b}
                              title="Live Vehicle Location Map"
                              defaultExpanded={true}
                            />
                            {/* SOS emergency button — only once the driver has accepted */}
                            {b.trip && (
                              <SafetyBanner
                                tripId={b.trip.id!}
                                driverId={b.driver_id}
                              />
                            )}
                          </div>
                        ) : b.status === "completed" ? (
                          <div className="mt-4 pt-3 border-t border-line">
                            <CompletedRideCard
                              booking={b}
                              onRatingSubmitted={() => void loadBookings()}
                            />
                          </div>
                        ) : b.status === "requested" ? (
                          <div className="mt-3 rounded-xl bg-brand/5 border border-brand/20 p-3 text-xs text-muted flex items-center gap-2">
                            <Clock className="h-4 w-4 text-brand shrink-0" />
                            <span>Waiting for driver approval. Once approved, the live vehicle map and SOS button will appear.</span>
                          </div>
                        ) : null}

                        <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-xs">
                          <span className="text-muted">Driver: {b.driver_name || "Assigned Driver"}</span>
                          {(b.status === "requested" || b.status === "accepted" || b.status === "confirmed") && (
                            <button
                              onClick={() => handleCancelBooking(b.id)}
                              className="text-danger hover:underline font-medium text-xs flex items-center gap-1 transition"
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
                          <Badge variant={b.status === "confirmed" || b.status === "accepted" ? "success" : "brand"}>
                            {b.status === "confirmed" || b.status === "accepted" ? "Approved Ride" : "Pending Approval"}
                          </Badge>
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
                        {(b.status === "accepted" || b.status === "confirmed") && (
                          <div className="pt-2">
                            <VehicleTrackingCard
                              booking={b}
                              title="Vehicle Location on Route"
                              defaultExpanded={true}
                            />
                          </div>
                        )}
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

interface CompletedRideCardProps {
  booking: Booking;
  onRatingSubmitted?: () => void;
}

function CompletedRideCard({ booking, onRatingSubmitted }: CompletedRideCardProps) {
  const [stars, setStars] = React.useState<number>(5);
  const [hoveredStars, setHoveredStars] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [submittedRating, setSubmittedRating] = React.useState<{ stars: number; comment?: string } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Check if this booking was already rated
  React.useEffect(() => {
    let active = true;
    ratingApi
      .forBooking(booking.id)
      .then((res) => {
        if (!active) return;
        if (res && res.items && res.items.length > 0) {
          const myReview = res.items.find((r) => r.booking_id === booking.id);
          if (myReview) {
            setSubmittedRating({ stars: myReview.stars, comment: myReview.comment || undefined });
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [booking.id]);

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await ratingApi.rate({
        booking_id: booking.id,
        stars,
        comment: comment.trim() || undefined,
      });
      setSubmittedRating({ stars, comment: comment.trim() || undefined });
      onRatingSubmitted?.();
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "Failed to submit rating");
    } finally {
      setSubmitting(false);
    }
  };

  const driverName = booking.driver_name || "Verified Driver";
  const sourceName = booking.trip?.source_name ?? booking.pickup?.name ?? "Origin";
  const destinationName = booking.trip?.destination_name ?? booking.dropoff?.name ?? "Destination";
  const finalFare = booking.amount ?? booking.cost_share ?? booking.estimated_contribution;

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-surface shadow-sm overflow-hidden">
      {/* Top Header Banner */}
      <div className="bg-emerald-500/10 border-b border-emerald-500/20 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-sm font-bold text-ink">
                Trip Completed · Destination Reached
              </h3>
              <Badge variant="success" className="text-[10px]">
                Completed ✓
              </Badge>
            </div>
            <p className="text-xs text-muted mt-0.5">
              <span>{sourceName} → {destinationName}</span>
              {finalFare != null && (
                <>
                  <span className="mx-1.5">·</span>
                  <span>Fare: <strong className="text-brand-teal">₹{Math.round(finalFare)}</strong></span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs font-semibold text-ink">
            Driver: <span className="text-brand-teal">{driverName}</span>
          </p>
          <p className="text-[11px] text-muted">Thanks for riding with VoltRide!</p>
        </div>
      </div>

      {/* Rating & Feedback Body */}
      <div className="p-4 bg-surface space-y-3">
        {submittedRating ? (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <p className="text-xs font-bold text-ink flex items-center gap-1.5">
                <span className="text-emerald-400">✓ Thank you for rating {driverName}!</span>
              </p>
              <div className="flex items-center gap-1 text-amber-400 text-sm">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`h-4 w-4 ${s <= submittedRating.stars ? "fill-amber-400 text-amber-400" : "text-muted/30"}`}
                  />
                ))}
                <span className="text-xs font-semibold text-ink ml-1.5">{submittedRating.stars}.0 / 5.0</span>
              </div>
              {submittedRating.comment && (
                <p className="text-xs text-muted italic">&ldquo;{submittedRating.comment}&rdquo;</p>
              )}
            </div>
            <button
              onClick={() => setSubmittedRating(null)}
              className="text-xs text-muted hover:text-ink underline"
            >
              Edit Rating
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitRating} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-ink">How was your ride with {driverName}?</p>
                <p className="text-[11px] text-muted">Rate your driver to help the community keep high standards.</p>
              </div>

              {/* Star selector */}
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => {
                  const active = (hoveredStars ?? stars) >= s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onMouseEnter={() => setHoveredStars(s)}
                      onMouseLeave={() => setHoveredStars(null)}
                      onClick={() => setStars(s)}
                      className="p-1 transition hover:scale-110 focus:outline-none"
                      aria-label={`${s} star`}
                    >
                      <Star
                        className={`h-6 w-6 transition ${
                          active
                            ? "fill-amber-400 text-amber-400 drop-shadow-sm"
                            : "text-muted/30 hover:text-amber-300"
                        }`}
                      />
                    </button>
                  );
                })}
                <span className="text-xs font-bold text-amber-400 ml-1.5 w-7 text-center">
                  {(hoveredStars ?? stars)}.0
                </span>
              </div>
            </div>

            {/* Comment input + submit */}
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={`Share your experience with ${driverName} (optional)...`}
                className="flex-1 rounded-xl border border-line bg-card px-3.5 py-2 text-xs text-ink placeholder:text-muted focus:border-brand-teal focus:outline-none"
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={submitting}
                className="text-xs font-semibold bg-brand-teal hover:bg-brand-teal/90 text-white shrink-0"
              >
                {submitting ? "Submitting…" : "Give Rating ★"}
              </Button>
            </div>
            {err && <p className="text-xs text-danger">{err}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
