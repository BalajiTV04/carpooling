"use client";
// /driver — driver dashboard hub.
// Profile + vehicle details, create live / monthly / pre-planned trips,
// fuel price + distance estimator, ratings average, recent trips.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/components/SessionProvider";
import { PageShell } from "@/components/PageShell";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { tripApi } from "@/lib/trips";
import { vehicleApi, type Vehicle } from "@/lib/vehicles";
import { ratingApi } from "@/lib/ratings";
import { fuelApi, type DistanceEstimate } from "@/lib/fuel";
import { SectionHeader } from "@/components/ui/SectionHeader";

type Role = "driver" | "passenger" | "admin";

export default function DriverDashboard() {
  return (
    <RequireAuth roles={["driver"] as Role[]}>
      <DriverInner />
    </RequireAuth>
  );
}

function DriverInner() {
  const { user, logout } = useSession();
  const isDriver = user?.roles?.includes("driver") ?? false;
  const approval = user?.driver_approval ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [cars, setCars] = useState<Vehicle[]>([]);
  const [rating, setRating] = useState<{ avg: number | null; count: number }>({ avg: null, count: 0 });
  const [fuel, setFuel] = useState<{ petrol: number; diesel: number } | null>(null);
  const [estimate, setEstimate] = useState<DistanceEstimate | null>(null);
  const [distErr, setDistErr] = useState<string | null>(null);
  const [fromLat, setFromLat] = useState("");
  const [fromLng, setFromLng] = useState("");
  const [toLat, setToLat] = useState("");
  const [toLng, setToLng] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      await Promise.all([
        tripApi.mine().then(setTrips).catch(() => setTrips([])),
        vehicleApi.list().then(setCars).catch(() => setCars([])),
        ratingApi.forUser(user?.id ?? "").then((r) =>
          setRating({ avg: r.rating_avg ?? null, count: r.rating_count })
        ).catch(() => setRating({ avg: null, count: 0 })),
        fuelApi.price().then(setFuel).catch(() => setFuel(null)),
      ]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { if (isDriver) load(); }, [isDriver, load]);

  if (loading) {
    return (
      <PageShell title="Driver Dashboard" eyebrow="Driver" wide>
        <div className="flex items-center justify-center py-12"><span className="loader"></span> Loading…</div>
      </PageShell>
    );
  }

  if (!isDriver) {
    return <PageShell title="Driver Dashboard" eyebrow="Driver"><p className="text-muted text-center py-12">Driver role required.</p></PageShell>;
  }

  const verifiedCars = cars.filter((c) => c.verification_status === "verified" && c.is_active);
  const completed = trips.filter((t) => t.status === "completed").length;
  const earned = trips.reduce((s, t) => s + (Number(t.distance_km) || 0), 0);

  const estimateTrip = async () => {
    setDistErr(null);
    if (!fromLat || !fromLng || !toLat || !toLng) {
      setDistErr("Pick both from and to points"); return;
    }
    try {
      const e = await fuelApi.distance({
        from_lat: Number(fromLat), from_lng: Number(fromLng),
        to_lat: Number(toLat), to_lng: Number(toLng),
        seats: 1,
      });
      setEstimate(e);
    } catch (e: unknown) {
      setDistErr(e instanceof Error ? e.message : "Estimate failed");
  return (
    <PageShell title="Driver Dashboard" eyebrow="Driver" wide>
      {err && <Alert variant="danger">{err}</Alert>}
      {approval === "pending" && (
        <Alert variant="warning">
          Your driver account is awaiting admin approval. You can add your car
          and details below, but trip publishing is unlocked once an admin
          approves you.
        </Alert>
      )}
      {approval === "rejected" && (
        <Alert variant="danger">
          Your driver application was rejected{" "}
          {user?.driver_approval_note ? "— " + user.driver_approval_note : ""}.
          Contact support or update your details and re-apply.
        </Alert>
      )}

      <section className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card padded>
          <CardBody>
            <p className="text-[11px] uppercase tracking-[.15em] text-muted">Total trips</p>
            <p className="stat-num mt-1">{trips.length}</p>
          </CardBody>
        </Card>
        <Card padded>
          <CardBody>
            <p className="text-[11px] uppercase tracking-[.15em] text-muted">Completed</p>
            <p className="stat-num mt-1 text-success">{completed}</p>
          </CardBody>
        </Card>
        <Card padded>
          <CardBody>
            <p className="text-[11px] uppercase tracking-[.15em] text-muted">Rating</p>
            <p className="stat-num mt-1">{rating.avg?.toFixed(1) ?? "—"}</p>
            <p className="text-[11px] text-muted">{rating.count} rating{rating.count !== 1 ? "s" : ""}</p>
          </CardBody>
        </Card>
        <Card padded>
          <CardBody>
            <p className="text-[11px] uppercase tracking-[.15em] text-muted">Km driven</p>
            <p className="stat-num mt-1">{earned.toFixed(0)}</p>
          </CardBody>
        </Card>
      </section>

      <section className="mt-6 panel p-5">
        <SectionHeader title="Fuel price & trip estimate" subtitle="Today's rate and km/cost before you plan" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="panel p-4">
            <p className="text-[11px] uppercase tracking-[.15em] text-muted mb-3">Fuel price (₹/litre)</p>
            <div className="grid gap-2">
              {fuel && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Petrol</span>
                    <span className="font-bold text-brand-teal">₹{fuel.petrol}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Diesel</span>
                    <span className="font-bold text-brand-teal">₹{fuel.diesel}</span>
                  </div>
                </>
              )}
              {!fuel && <span className="text-muted text-xs">—</span>}
            </div>
          </div>

          <div className="panel p-4">
            <p className="text-[11px] uppercase tracking-[.15em] text-muted mb-3">From → To (lat, lng)</p>
            <Input label="From lat" value={fromLat} onChange={(e) => setFromLat(e.target.value)} placeholder="e.g. 28.61" />
            <Input label="From lng" value={fromLng} onChange={(e) => setFromLng(e.target.value)} placeholder="e.g. 77.20" />
            <Input label="To lat" value={toLat} onChange={(e) => setToLat(e.target.value)} placeholder="e.g. 28.70" />
            <Input label="To lng" value={toLng} onChange={(e) => setToLng(e.target.value)} placeholder="e.g. 77.30" />
            <button onClick={estimateTrip} className="btn btn-primary w-full py-2 mt-2 text-sm">
              {estimate ? "Re-estimate" : "Estimate km & cost"}
            </button>
            {distErr && <p className="mt-2 text-xs text-danger">{distErr}</p>}
          </div>

          <div className="panel p-4">
            <p className="text-[11px] uppercase tracking-[.15em] text-muted mb-3">Estimate</p>
            {estimate ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-muted">Distance</span><span className="font-bold">{estimate.distance_km} km</span></div>
                <div className="flex items-center justify-between"><span className="text-muted">Fuel cost</span><span className="font-bold text-brand-teal">₹{estimate.estimated_fuel_cost}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted">Per km</span><span className="text-muted">₹{estimate.cost_per_km}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted">Per passenger share</span><span className="font-bold">₹{estimate.per_passenger_share}</span></div>
                <p className="text-[10px] text-muted">{estimate.note}</p>
              </div>
            ) : (
              <span className="text-muted text-xs">Enter from & to to estimate</span>
            )}
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/trips" className="panel panel-hover block p-5 text-center hover:border-brand-teal/40">
          <div className="mx-auto mb-3 rounded-full bg-brand-teal/10 p-3 text-brand-teal font-bold text-xl">🚗</div>
          <p className="font-display font-bold text-ink">Live trip</p>
          <p className="mt-2 text-xs text-muted">From → To · date · time · seats · go live now</p>
        </Link>
        <a href="/trips" className="panel panel-hover block p-5 text-center hover:border-brand-teal/40">
          <div className="mx-auto mb-3 rounded-full bg-brand-teal/10 p-3 text-brand-teal font-bold text-xl">📅</div>
          <p className="font-display font-bold text-ink">Monthly plan</p>
          <p className="mt-2 text-xs text-muted">Same route, recurring — for workers/commuters</p>
        </a>
        <a href="/trips" className="panel panel-hover block p-5 text-center hover:border-brand-teal/40">
          <div className="mx-auto mb-3 rounded-full bg-brand-teal/10 p-3 text-brand-teal font-bold text-xl">⏰</div>
          <p className="font-display font-bold text-ink">Pre-booking</p>
          <p className="mt-2 text-xs text-muted">Direction + destination + date + start/end time</p>
        </a>
      </section>

      {/* My vehicles */}
      <section className="mt-6">
        <SectionHeader title="My vehicles" subtitle="Add a car in the garage to publish trips" />
        {verifiedCars.length === 0 && cars.length === 0 ? (
          <div className="mt-3 panel p-4 text-center">
            <p className="text-sm text-muted">No vehicles yet.</p>
            <Link href="/garage" className="mt-3 inline-block btn btn-primary btn-sm">Add vehicle →</Link>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {cars.map((c) => (
              <Card key={c.id} hover padded>
                <CardBody>
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-display font-bold text-ink">{c.make} {c.model}</p>
                    <Badge variant={c.verification_status === "verified" ? "success" : "brand"}>
                      {c.verification_status.charAt(0).toUpperCase() + c.verification_status.slice(1)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted mb-1">{c.plate_no} · {c.seats_total} seats · {c.fuel_type} · {c.year ?? "—"} · {c.mileage_kmpl ?? "—"} km/l</p>
                  {c.image_url && <img src={c.image_url} alt={c.make} className="mt-2 rounded-lg h-24 w-24 object-cover border border-line" />}
                  {c.verification_status !== "verified" && (
                    <p className="mt-2 text-[11px] text-muted">Awaiting admin verification.</p>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Recent trips */}
      <section className="mt-6">
        <SectionHeader title="Recent trips" subtitle="Your published and completed trips" />
        {trips.length === 0 ? (
          <EmptyState title="No trips yet" message="Create your first live trip above." />
        ) : (
          <div className="mt-3 grid gap-3">
            {trips.slice(0, 5).map((t) => (
              <Card key={t.id} hover padded>
                <CardBody>
                  <p className="font-display font-bold text-ink truncate">{t.source_name} → {t.destination_name}</p>
                  <p className="text-sm text-muted mt-1">{new Date(t.depart_at).toLocaleString()} · {t.seats_booked}/{t.seats_offered} seats · {t.status}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 flex justify-end gap-2">
        <Link href="/me" className="btn btn-ghost btn-sm">Edit profile →</Link>
        <button onClick={() => { logout(); window.location.href = "/"; }}
          className="btn btn-danger btn-sm">Logout</button>
      </div>
    </PageShell>
  );
}
