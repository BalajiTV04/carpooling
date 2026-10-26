"use client";
// /admin (Module 21): live operations console — platform cards, user
// moderation, trip board, and the alert queue. Admins only (RequireAuth +
// require_roles server-side); without the admin role this page is a locked card.
import { useCallback, useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { adminApi, severityCls, type AdminAlert, type AdminStats, type AdminTrip, type AdminUser, type PendingVehicle } from "@/lib/admin";

function Card({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="panel panel-hover p-4">
      <p className="text-[11px] uppercase tracking-[.15em] text-muted">{label}</p>
      <p className="stat-num mt-1">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminInner />
    </RequireAuth>
  );
}

function AdminInner() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [trips, setTrips] = useState<AdminTrip[]>([]);
  const [liveOnly, setLiveOnly] = useState(true);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [pendingCars, setPendingCars] = useState<PendingVehicle[]>([]);
  const [tab, setTab] = useState<"users" | "trips" | "cars" | "alerts">("alerts");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, t, a] = await Promise.all([
        adminApi.stats(),
        adminApi.trips(liveOnly),
        adminApi.alerts("open"),
      ]);
      setStats(s);
      setTrips(t.trips);
      setAlerts(a.alerts);
      adminApi.pendingVehicles().then(setPendingCars).catch(() => setPendingCars([]));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Console load failed");
    }
  }, [liveOnly]);

  const loadUsers = useCallback(async () => {
    setErr(null);
    try {
      setUsers((await adminApi.users(q)).users);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "User search failed");
    }
  }, [q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await Promise.all([load(), loadUsers()]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Operations console"
      eyebrow="Admin · Module 21"
      subtitle="Who is on the road, who needs attention, who breaks the rules."
      wide
    >
      {err && <p className="alert alert-err mt-4">{err}</p>}
      {msg && <p className="alert alert-ok mt-4">{msg}</p>}

      {stats && (
        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Live trips" value={stats.trips.live} note={`${stats.trips.total} total`} />
          <Card label="Open alerts" value={stats.alerts.open} note={`${stats.alerts.critical_open} critical`} />
          <Card label="Active users" value={stats.users.active} note={`${stats.users.suspended} suspended`} />
          <Card label="Completed" value={stats.trips.completed} note={`${stats.trips.completion_rate_pct}% completion`} />
          <Card label="Verified phones" value={`${stats.users.verified_pct}%`} note={`${stats.users.phone_verified}/${stats.users.total}`} />
          <Card label="Cars pending" value={stats.vehicles.pending} note={`${stats.vehicles.total} registered`} />
          <Card label="Settled seats" value={stats.bookings.settled_seats} note={`${stats.bookings.total} bookings`} />
          <Card label="Push sockets" value={stats.stream.sockets} note={`${stats.stream.pushed} pushed · ${stats.stream.dropped} dropped`} />
        </section>
      )}

      <div className="tabbar mt-6">
        {(["alerts", "trips", "cars", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tab ${tab === t ? "tab-active" : ""}`}
          >
            {t}
            {t === "alerts" && alerts.length > 0 ? ` (${alerts.length})` : ""}
            {t === "cars" && pendingCars.length > 0 ? ` (${pendingCars.length})` : ""}
          </button>
        ))}
      </div>
      {tab === "alerts" && (
        <div className="mt-4 grid gap-2">
          {alerts.length === 0 && (
            <p className="empty">
              No open alerts. The road is quiet.
            </p>
          )}
          {alerts.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 text-xs ${severityCls(a.severity)}`}>
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {a.type.toUpperCase()} · {a.severity}{" "}
                  <span className="font-normal opacity-80">
                    {a.source_name} → {a.destination_name}{a.driver_name ? ` · ${a.driver_name}` : ""}
                  </span>
                </p>
                <p className="truncate opacity-75">
                  {a.status} · {new Date(a.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => act(() => adminApi.resolve(a.id), "Alert resolved — off the queue.")}
                className="btn btn-ghost btn-sm shrink-0 border-current"
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "trips" && (
        <div className="mt-4 grid gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
            Ongoing only
          </label>
          {trips.map((t) => (
            <div key={t.id} className="panel panel-hover p-3 text-xs">
              <p className="font-display font-bold">{t.source_name} → {t.destination_name}</p>
              <p className="mt-0.5 text-muted">
                {t.status} · {t.seats_booked}/{t.seats_offered} seats · driver {t.driver_name ?? t.driver_id.slice(-6)}
                {t.tracked ? " · tracked" : " · no GPS yet"}
                {t.open_alerts > 0 && <span className="text-rose-300"> · {t.open_alerts} open alert{t.open_alerts > 1 ? "s" : ""}</span>}
                {t.recurring && <span className="text-brand-teal"> · recurring</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {tab === "cars" && (
        <div className="mt-4 grid gap-2">
          {pendingCars.length === 0 && (
            <p className="empty">
              No cars waiting for verification.
            </p>
          )}
          {pendingCars.map((v) => (
            <div key={v.id} className="panel panel-hover flex flex-wrap items-center gap-2 p-3 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {v.make} {v.model} <span className="font-normal text-muted">{v.plate_no}</span>
                </p>
                <p className="text-muted">
                  {v.seats_total} seats · {v.fuel_type} · {v.verification_status}
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => act(() => adminApi.verifyVehicle(v.id, "verified"), "Car verified — the driver can publish now.")}
                className="btn btn-primary btn-sm"
              >
                Verify
              </button>
              <button
                disabled={busy}
                onClick={() => act(() => adminApi.verifyVehicle(v.id, "rejected", "documents unclear"), "Car rejected with a note.")}
                className="btn btn-danger btn-sm"
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <div className="mt-4">
          <div className="flex gap-2">
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="name or phone fragment…"
              className="input min-w-0 flex-1 rounded-full"
            />
            <button onClick={loadUsers} className="btn btn-primary">Search</button>
          </div>
          <div className="mt-3 grid gap-2">
            {users.map((u) => (
              <div key={u.id} className="panel panel-hover flex flex-wrap items-center gap-2 p-3 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{u.full_name ?? "—"} <span className="font-normal text-muted">{u.phone}</span></p>
                  <p className="text-muted">{u.roles.join(" · ") || "no roles"} · {u.status}</p>
                </div>
                {u.status === "active" ? (
                  <button disabled={busy} onClick={() => act(() => adminApi.suspend(u.id), "Account suspended — tokens revoked.")}
                    className="btn btn-danger btn-sm">Suspend</button>
                ) : (
                  <button disabled={busy} onClick={() => act(() => adminApi.reactivate(u.id), "Account reactivated.")}
                    className="btn btn-ghost btn-sm text-brand-teal">Reactivate</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}

