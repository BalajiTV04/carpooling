"use client";
// /admin (Module 21): live operations console — platform cards, user
// moderation, trip board, and the alert queue. Admins only (RequireAuth +
// require_roles server-side); without the admin role this page is a locked card.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { adminApi, severityCls, type AdminAlert, type AdminStats, type AdminTrip, type AdminUser, type PendingVehicle } from "@/lib/admin";

function Card({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-4">
      <p className="text-[11px] uppercase tracking-[.15em] text-[#A5ABD6]">{label}</p>
      <p className="font-display mt-1 text-2xl font-bold text-[#EEF0FF]">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-[#5b6194]">{note}</p>}
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
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-10">
      <Link href="/" className="text-sm text-volt-300">← VoltRide</Link>
      <h1 className="font-display mt-2 text-3xl font-bold">Operations console</h1>
      <p className="mt-1 text-sm text-[#A5ABD6]">
        Who is on the road, who needs attention, who breaks the rules.
      </p>
      {err && <p className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      {msg && <p className="mt-3 rounded-2xl border border-volt-400/40 bg-volt-400/10 p-3 text-sm text-volt-300">{msg}</p>}

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

      <div className="mt-6 flex gap-2">
        {(["alerts", "trips", "cars", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${tab === t ? "bg-volt-400 text-night-950" : "border border-[rgba(154,151,255,.35)] text-[#A5ABD6]"}`}
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
            <p className="rounded-xl3 border border-dashed border-[rgba(154,151,255,.35)] p-6 text-center text-sm text-[#A5ABD6]">
              No open alerts. The road is quiet.
            </p>
          )}
          {alerts.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-center gap-2 rounded-xl3 px-3 py-2.5 text-xs ${severityCls(a.severity)}`}>
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
                className="shrink-0 rounded-full border border-current px-3 py-1 text-[11px] font-bold disabled:opacity-50"
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "trips" && (
        <div className="mt-4 grid gap-2">
          <label className="flex items-center gap-2 text-xs text-[#A5ABD6]">
            <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
            Ongoing only
          </label>
          {trips.map((t) => (
            <div key={t.id} className="rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-3 text-xs">
              <p className="font-display font-bold">{t.source_name} → {t.destination_name}</p>
              <p className="mt-0.5 text-[#A5ABD6]">
                {t.status} · {t.seats_booked}/{t.seats_offered} seats · driver {t.driver_name ?? t.driver_id.slice(-6)}
                {t.tracked ? " · tracked" : " · no GPS yet"}
                {t.open_alerts > 0 && <span className="text-rose-300"> · {t.open_alerts} open alert{t.open_alerts > 1 ? "s" : ""}</span>}
                {t.recurring && <span className="text-volt-300"> · recurring</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {tab === "cars" && (
        <div className="mt-4 grid gap-2">
          {pendingCars.length === 0 && (
            <p className="rounded-xl3 border border-dashed border-[rgba(154,151,255,.35)] p-6 text-center text-sm text-[#A5ABD6]">
              No cars waiting for verification.
            </p>
          )}
          {pendingCars.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-3 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {v.make} {v.model} <span className="font-normal text-[#A5ABD6]">{v.plate_no}</span>
                </p>
                <p className="text-[#A5ABD6]">
                  {v.seats_total} seats · {v.fuel_type} · {v.verification_status}
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => act(() => adminApi.verifyVehicle(v.id, "verified"), "Car verified — the driver can publish now.")}
                className="rounded-full bg-volt-400 px-3 py-1 font-bold text-night-950 disabled:opacity-50"
              >
                Verify
              </button>
              <button
                disabled={busy}
                onClick={() => act(() => adminApi.verifyVehicle(v.id, "rejected", "documents unclear"), "Car rejected with a note.")}
                className="rounded-full border border-rose-400/50 px-3 py-1 text-rose-300 disabled:opacity-50"
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
              className="min-w-0 flex-1 rounded-full border border-[rgba(154,151,255,.3)] bg-night-900 px-4 py-2 text-sm text-[#EEF0FF]"
            />
            <button onClick={loadUsers} className="rounded-full bg-volt-400 px-4 py-2 text-sm font-bold text-night-950">Search</button>
          </div>
          <div className="mt-3 grid gap-2">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-3 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{u.full_name ?? "—"} <span className="font-normal text-[#A5ABD6]">{u.phone}</span></p>
                  <p className="text-[#A5ABD6]">{u.roles.join(" · ") || "no roles"} · {u.status}</p>
                </div>
                {u.status === "active" ? (
                  <button disabled={busy} onClick={() => act(() => adminApi.suspend(u.id), "Account suspended — tokens revoked.")}
                    className="rounded-full border border-rose-400/50 px-3 py-1 text-rose-300 disabled:opacity-50">Suspend</button>
                ) : (
                  <button disabled={busy} onClick={() => act(() => adminApi.reactivate(u.id), "Account reactivated.")}
                    className="rounded-full border border-volt-400/50 px-3 py-1 text-volt-300 disabled:opacity-50">Reactivate</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

