"use client";

import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/components/SessionProvider";
import { tripApi } from "@/lib/trips";
import { searchApi } from "@/lib/search";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card, Badge } from "@/components/ui";
import { Pill } from "@/components/ui/Pill";
import { Loader } from "@/components/ui/Loader";

export default function PassengerDashboard() {
  const { user, logout } = useSession();
  const isPassenger = user?.roles?.includes("passenger") ?? false;

  // Check driver approval status from the user document
  const [driverApproval, setDriverApproval] = useState<string | null>(null);
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isPassenger) return;
    setDriverApproval(user?.driver_approval ?? null);
  }, [user]);

  if (!isPassenger) {
    return <p className="text-muted text-center py-12">Passenger role required</p>;
  }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [t, b] = await Promise.all([tripApi.mine(), /* booking API would go here */]);
        setTrips(t ?? []);
        setBookings(b ?? []);
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
        setLoading(false);
      }
    };
    load();
  }, [isPassenger]);

  if (loading) return <div className="min-h-screen flex items-center justify-center p-8"><Loader /></div>;
  if (error) return <p className="alert alert-danger mt-6">{error}</p>;

  return (
    <div className="min-h-screen bg-token-bg">
      <nav className="border-b border-line pb-4">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-ink">Passenger Dashboard</h2>
            <button onClick={logout} className="btn btn-ghost text-sm text-muted">
              Logout
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl p-4 md:p-8">
        <SectionHeader title="Overview" subtitle="Your ride statistics">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardBody>
                <h3 className="font-semibold text-muted">Upcoming Rides</h3>
                <p className="text-3xl font-bold text-brand">—</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <h3 className="font-semibold text-muted">Completed Rides</h3>
                <p className="text-3xl font-bold text-brand">—</p>
              </CardBody>
            </Card>
          </div>
        </SectionHeader>

        <SectionHeader title="Find a Ride" subtitle="Search for available rides">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <p className="text-sm text-muted">From:</p>
              <p className="text-xs text-muted mt-2">[Place picker]</p>
            </div>
            <div>
              <p className="text-sm text-muted">To:</p>
              <p className="text-xs text-muted mt-2">[Place picker]</p>
            </div>
          </div>
          <div className="mt-6">
            <p className="text-sm text-muted">Date:</p>
            <p className="text-xs text-muted mt-2">[Date picker]</p>
          </div>
          <div className="mt-6">
            <p className="text-sm text-muted">Seats needed:</p>
            <p className="text-xs text-muted mt-2">[Seat selector]</p>
          </div>
          <div className="mt-8">
            <button className="btn btn-primary">Search rides →</button>
            <p className="text-xs text-muted mt-2">Filter by date, seats, and trip type.</p>
          </div>
        </SectionHeader>

        <SectionHeader title="My Bookings" subtitle="Your ride history">
          {bookings.length === 0 ? (
            <EmptyState
              icon={<svg className="h-6 w-6 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1={5} y1={19} x2={13} y2={5}></line>
                <line x1={12} y1={5} x2={19} y2={19}></line>
              </svg>}
              title="No bookings yet"
              message="Search for rides above to find and book a trip."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {bookings.map((b) => (
                <Card key={b.id} className="p-4">
                  <h4 className="font-display font-bold text-ink truncate">{b.trip?.source_name ?? "Trip"}</h4>
                  <p className="text-sm text-muted">{b.trip?.destination_name ?? "—"} · {b.seats} seats · {b.status}</p>
                </Card>
              ))}
            </div>
          )}
        </SectionHeader>
      </main>
    </div>
  );
}
