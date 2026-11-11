﻿"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Database,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPinned,
  Menu,
  ShieldCheck,
  UserCog,
  Users,
  UserRoundCheck,
  X,
  Truck,
} from "lucide-react";
import { useSession } from "@/components/SessionProvider";
import { NotificationBell } from "@/components/NotificationBell";
import { adminApi, type AdminAlert, type AdminDriver, type AdminStats, type AdminTripRequest, type AdminUser, type PendingVehicle } from "@/lib/admin";
import { profileApi, type FullProfile } from "@/lib/profile";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

type Section = "overview" | "profile" | "map" | "users" | "alerts" | "requests" | "vehicles";
type NavItem = { id: Section; label: string; icon: React.ElementType };

const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "profile", label: "My profile", icon: UserCog },
  { id: "map", label: "Data map", icon: MapPinned },
  { id: "users", label: "Users", icon: Users },
  { id: "alerts", label: "Alerts", icon: AlertTriangle },
  { id: "requests", label: "Requests", icon: UserRoundCheck },
  { id: "vehicles", label: "Vehicle details & approval", icon: Truck },
];

const inputClass = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15";
const panelClass = "rounded-2xl border border-line bg-surface shadow-sm";

export default function AdminDashboardPage() {
  const { user, ready, logout, refresh } = useSession();
  const router = useRouter();
  const [section, setSection] = React.useState<Section>("overview");
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [stats, setStats] = React.useState<AdminStats | null>(null);
  const [profile, setProfile] = React.useState<FullProfile | null>(null);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [alerts, setAlerts] = React.useState<AdminAlert[]>([]);
  const [drivers, setDrivers] = React.useState<AdminDriver[]>([]);
  const [tripRequests, setTripRequests] = React.useState<AdminTripRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [vehicles, setVehicles] = React.useState<PendingVehicle[]>([]);

  const loadConsole = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    // Load each endpoint independently so one failing call cannot blank out all stats.
    const loadStats = async () => {
      try {
        const s = await adminApi.stats();
        setStats(s);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load platform stats.");
      }
    };
    const loadProfile = async () => {
      try {
        const p = await profileApi.mine();
        setProfile(p);
      } catch {
        /* profile is non-critical; leave null */ }
    };
    const loadUsers = async () => {
      try {
        const r = await adminApi.users();
        setUsers(r.users ?? []);
      } catch {
        /* users list is non-critical; leave empty */ }
    };
    const loadAlerts = async () => {
      try {
        const r = await adminApi.alerts("open");
        setAlerts(r.alerts ?? []);
      } catch {
        /* alerts are non-critical; leave empty */ }
    };
    const loadDrivers = async () => {
      try {
        const r = await adminApi.drivers("", "pending");
        setDrivers(r.drivers ?? []);
      } catch {
        /* driver requests are non-critical; leave empty */ }
    };
    const loadTripRequests = async () => {
      try {
        const r = await adminApi.tripRequests();
        setTripRequests(r.trips ?? []);
      } catch {
        /* trip requests are non-critical; leave empty */ }
    };
    const loadVehicles = async () => {
      try {
        const r = await adminApi.pendingVehicles();
        setVehicles(r);
      } catch {
        /* vehicle requests are non-critical; leave empty */ }
    };
    await Promise.all([
      loadStats(),
      loadProfile(),
      loadUsers(),
      loadAlerts(),
      loadDrivers(),
      loadTripRequests(),
      loadVehicles(),
    ]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    if (!user?.roles?.includes("admin")) {
      router.replace("/admin/login");
      return;
    }
    void loadConsole();
  }, [ready, user, router, loadConsole]);

  const chooseSection = (next: Section) => {
    setSection(next);
    setMobileOpen(false);
    setNotice(null);
  };

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("profile");
    setError(null);
    try {
      const updated = await profileApi.update({
        full_name: String(form.get("full_name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim() || null,
      });
      setProfile(updated);
      await refresh();
      setNotice("Admin details updated successfully.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update admin details.");
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("password");
    setError(null);
    try {
      await profileApi.changePassword({
        current_password: String(form.get("current_password") ?? ""),
        new_password: String(form.get("new_password") ?? ""),
      });
      event.currentTarget.reset();
      setNotice("Password changed successfully.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change password.");
    } finally {
      setBusy(null);
    }
  };

  const updateUserStatus = async (account: AdminUser) => {
    const action = account.status === "active" ? "suspend" : "reactivate";
    setBusy(`user-${account.id}`);
    setError(null);
    try {
      await (action === "suspend" ? adminApi.suspend(account.id) : adminApi.reactivate(account.id));
      setUsers((current) => current.map((item) => item.id === account.id ? { ...item, status: action === "suspend" ? "suspended" : "active" } : item));
      setNotice(`Account ${action === "suspend" ? "suspended" : "reactivated"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the user.");
    } finally {
      setBusy(null);
    }
  };

  const resolveAlert = async (alertId: string) => {
    setBusy(`alert-${alertId}`);
    setError(null);
    try {
      await adminApi.resolve(alertId);
      setAlerts((current) => current.filter((alert) => alert.id !== alertId));
      setNotice("Alert marked as resolved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resolve the alert.");
    } finally {
      setBusy(null);
    }
  };

  const decideDriver = async (driverId: string, decision: "approved" | "rejected") => {
    setBusy(`driver-${driverId}`);
    setError(null);
    try {
      await adminApi.approveDriver(driverId, decision);
      setDrivers((current) => current.filter((driver) => driver.id !== driverId));
      setNotice(`Driver request ${decision === "approved" ? "approved" : "denied"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the driver request.");
    } finally {
      setBusy(null);
    }
  };

  const decideTripRequest = async (tripId: string, decision: "approved" | "rejected") => {
    setBusy(`trip-${tripId}`);
    setError(null);
    try {
      await adminApi.reviewTripRequest(tripId, decision);
      setTripRequests((current) => current.filter((trip) => trip.id !== tripId));
      setNotice(`Live trip ${decision === "approved" ? "approved and published" : "rejected"}. The driver has been notified.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to review the trip request.");
    } finally {
      setBusy(null);
    }
  };
  const verifyVehicle = async (vehicleId: string, decision: "verified" | "rejected") => {
    setBusy(`vehicle-${vehicleId}`);
    setError(null);
    try {
      await adminApi.verifyVehicle(vehicleId, decision);
      setVehicles((current) => current.filter((vehicle) => vehicle.id !== vehicleId));
      setNotice(`Vehicle ${decision === "verified" ? "verified" : "rejected"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to review the vehicle request.");
    } finally {
      setBusy(null);
    }
  };

  if (!ready || !user?.roles?.includes("admin")) return null;

  const filteredUsers = users.filter((account) => {
    const value = query.toLowerCase();
    return !value || account.full_name?.toLowerCase().includes(value) || account.phone?.toLowerCase().includes(value);
  });

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <Sidebar active={section} userName={user.full_name || user.phone} onSelect={chooseSection} onLogout={handleLogout} />
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:px-8">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileOpen(true)} className="rounded-xl p-2 text-muted hover:bg-card hover:text-ink lg:hidden" aria-label="Open admin navigation"><Menu className="h-5 w-5" /></button>
              <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">Administration</p><h1 className="font-display text-lg font-bold text-ink">{NAV_ITEMS.find((item) => item.id === section)?.label}</h1></div>
            </div>
            <div className="flex items-center gap-2"><NotificationBell enabled={!!user} /><button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted transition hover:bg-danger/10 hover:text-danger"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Logout</span></button></div>
          </header>
          <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
            {error && <Alert variant="danger" className="mb-5">{error}</Alert>}
            {notice && <Alert variant="success" className="mb-5 flex items-center justify-between gap-3"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X className="h-4 w-4" /></button></Alert>}
            {loading ? <LoadingWorkspace /> : <Workspace section={section} stats={stats} profile={profile} users={filteredUsers} alerts={alerts} drivers={drivers} tripRequests={tripRequests} vehicles={vehicles} query={query} busy={busy} onQueryChange={setQuery} onSaveProfile={saveProfile} onChangePassword={changePassword} onUpdateUser={updateUserStatus} onResolveAlert={resolveAlert} onDecideDriver={decideDriver} onDecideTripRequest={decideTripRequest} onVerifyVehicle={verifyVehicle} />}
          </main>
        </div>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute inset-0 bg-black/50" /><aside className="relative flex h-full w-80 max-w-[86vw] flex-col border-r border-line bg-surface shadow-2xl"><Sidebar active={section} userName={user.full_name || user.phone} onSelect={chooseSection} onLogout={handleLogout} close={() => setMobileOpen(false)} /></aside></div>}
    </div>
  );
}

function Sidebar({ active, userName, onSelect, onLogout, close }: { active: Section; userName: string; onSelect: (section: Section) => void; onLogout: () => void; close?: () => void }) {
  return <><div className="flex items-center justify-between border-b border-line px-6 py-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-teal/15 p-2 text-brand-teal"><ShieldCheck className="h-5 w-5" /></div><div><p className="font-display font-bold">VoltRide</p><p className="text-xs text-muted">Admin workspace</p></div></div>{close && <button onClick={close} className="rounded-lg p-2 text-muted hover:bg-card"><X className="h-5 w-5" /></button>}</div><nav className="flex-1 space-y-1 px-4 py-5">{NAV_ITEMS.map((item) => { const Icon = item.icon; const selected = active === item.id; return <button key={item.id} onClick={() => onSelect(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${selected ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-card hover:text-ink"}`}><Icon className="h-5 w-5" />{item.label}</button>; })}</nav><div className="border-t border-line p-4"><div className="mb-3 rounded-xl bg-card px-4 py-3"><p className="truncate text-sm font-semibold text-ink">{userName}</p><p className="text-xs text-muted">Administrator</p></div><button onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-muted transition hover:bg-danger/10 hover:text-danger"><LogOut className="h-5 w-5" />Logout</button></div></>;
}

function Workspace(props: { section: Section; stats: AdminStats | null; profile: FullProfile | null; users: AdminUser[]; alerts: AdminAlert[]; drivers: AdminDriver[]; tripRequests: AdminTripRequest[]; vehicles: PendingVehicle[]; query: string; busy: string | null; onQueryChange: (value: string) => void; onSaveProfile: (event: React.FormEvent<HTMLFormElement>) => void; onChangePassword: (event: React.FormEvent<HTMLFormElement>) => void; onUpdateUser: (user: AdminUser) => void; onResolveAlert: (id: string) => void; onDecideDriver: (id: string, decision: "approved" | "rejected") => void; onDecideTripRequest: (id: string, decision: "approved" | "rejected") => void; onVerifyVehicle: (id: string, decision: "verified" | "rejected") => void }) {
  const { section, stats, profile, users, alerts, drivers, tripRequests, vehicles, query, busy } = props;
  if (section === "profile") return <ProfileSection profile={profile} busy={busy} onSave={props.onSaveProfile} onPassword={props.onChangePassword} />;
  if (section === "map") return <MapSection stats={stats} />;
  if (section === "users") return <UsersSection users={users} query={query} busy={busy} onQueryChange={props.onQueryChange} onUpdate={props.onUpdateUser} />;
  if (section === "alerts") return <AlertsSection alerts={alerts} busy={busy} onResolve={props.onResolveAlert} />;
  if (section === "requests") return <RequestsSection drivers={drivers} tripRequests={tripRequests} busy={busy} onDecide={props.onDecideDriver} onDecideTrip={props.onDecideTripRequest} />;
  if (section === "vehicles") return <VehiclesSection vehicles={vehicles} busy={busy} onVerify={props.onVerifyVehicle} />;
  return <OverviewSection stats={stats} alerts={alerts} drivers={drivers} />;
}

function OverviewSection({ stats, alerts, drivers }: { stats: AdminStats | null; alerts: AdminAlert[]; drivers: AdminDriver[] }) {
  const cards = [["Total users", stats?.users.total ?? 0, Users, "Registered accounts"], ["Active drivers", stats?.users.drivers ?? 0, UserRoundCheck, "Driver accounts"], ["Live trips", stats?.trips.live ?? 0, MapPinned, "Currently in progress"], ["Open alerts", stats?.alerts.open ?? 0, AlertTriangle, "Need attention"]] as const;
  return <div className="space-y-6"><div><h2 className="font-display text-2xl font-bold">Platform overview</h2><p className="mt-1 text-sm text-muted">Monitor platform activity and complete administrative work.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon, hint]) => <div key={label} className={`${panelClass} p-5`}><div className="flex items-start justify-between"><div><p className="text-sm text-muted">{label}</p><p className="mt-2 text-3xl font-bold text-ink">{value}</p><p className="mt-2 text-xs text-muted">{hint}</p></div><div className="rounded-xl bg-brand-teal/10 p-3 text-brand-teal"><Icon className="h-5 w-5" /></div></div></div>)}</div><div className="grid gap-6 xl:grid-cols-2"><section className={`${panelClass} p-6`}><div className="mb-5 flex items-center justify-between"><div><h3 className="font-semibold">Pending driver requests</h3><p className="text-sm text-muted">Drivers waiting for approval.</p></div><span className="rounded-full bg-warn/10 px-3 py-1 text-sm font-semibold text-warn">{drivers.length}</span></div>{drivers.length ? <div className="space-y-3">{drivers.slice(0, 4).map((driver) => <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3" key={driver.id}><div><p className="font-medium">{driver.full_name || "Unnamed driver"}</p><p className="text-xs text-muted">{driver.phone || "No phone"}</p></div><span className="text-xs font-medium text-warn">Pending</span></div>)}</div> : <Empty label="No driver approvals are waiting." />}</section><section className={`${panelClass} p-6`}><div className="mb-5 flex items-center justify-between"><div><h3 className="font-semibold">Recent open alerts</h3><p className="text-sm text-muted">Safety and operational events.</p></div><span className="rounded-full bg-danger/10 px-3 py-1 text-sm font-semibold text-danger">{alerts.length}</span></div>{alerts.length ? <div className="space-y-3">{alerts.slice(0, 4).map((alert) => <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3" key={alert.id}><div><p className="font-medium capitalize">{alert.type.replaceAll("_", " ")}</p><p className="text-xs text-muted">{alert.source_name || "Route information unavailable"}</p></div><Severity severity={alert.severity} /></div>)}</div> : <Empty label="No open alerts right now." />}</section></div></div>;
}

function ProfileSection({ profile, busy, onSave, onPassword }: { profile: FullProfile | null; busy: string | null; onSave: (event: React.FormEvent<HTMLFormElement>) => void; onPassword: (event: React.FormEvent<HTMLFormElement>) => void }) { return <div className="space-y-6"><div><h2 className="font-display text-2xl font-bold">My profile</h2><p className="mt-1 text-sm text-muted">View your administrator details, update username/email, or change your password.</p></div><div className="grid gap-6 xl:grid-cols-2"><section className={`${panelClass} p-6`}><div className="mb-5 flex items-center gap-3"><div className="rounded-full bg-brand-teal/10 p-3 text-brand-teal"><UserCog className="h-5 w-5" /></div><div><h3 className="font-semibold">Admin details</h3><p className="text-sm text-muted">Update username and email only.</p></div></div><form onSubmit={onSave} className="space-y-4"><label className="block text-sm font-medium">Username<input name="full_name" className={`${inputClass} mt-1.5`} defaultValue={profile?.full_name ?? ""} required /></label><label className="block text-sm font-medium">Email<input name="email" type="email" className={`${inputClass} mt-1.5`} defaultValue={profile?.email ?? ""} placeholder="admin@example.com" /></label><div className="rounded-xl bg-card px-4 py-3 text-sm"><p className="text-muted">Login phone</p><p className="mt-1 font-medium">{profile?.phone ?? "—"}</p></div><Button type="submit" disabled={busy === "profile"}>{busy === "profile" ? "Saving…" : "Update details"}</Button></form></section><section className={`${panelClass} p-6`}><div className="mb-5 flex items-center gap-3"><div className="rounded-full bg-brand/10 p-3 text-brand"><LockKeyhole className="h-5 w-5" /></div><div><h3 className="font-semibold">Change password</h3><p className="text-sm text-muted">Use your current password to confirm this change.</p></div></div><form onSubmit={onPassword} className="space-y-4"><label className="block text-sm font-medium">Current password<input name="current_password" type="password" className={`${inputClass} mt-1.5`} required /></label><label className="block text-sm font-medium">New password<input name="new_password" type="password" minLength={6} className={`${inputClass} mt-1.5`} required /></label><Button type="submit" variant="secondary" disabled={busy === "password"}>{busy === "password" ? "Changing…" : "Change password"}</Button></form></section></div></div>; }

function MapSection({ stats }: { stats: AdminStats | null }) { return <div className="space-y-6"><div><h2 className="font-display text-2xl font-bold">Data map</h2><p className="mt-1 text-sm text-muted">A high-level map of the operational data managed by the platform.</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><DataCard title="Location records" value={stats?.locations ?? 0} icon={MapPinned} description="Recorded route and live-location points." /><DataCard title="Trip records" value={stats?.trips.total ?? 0} icon={Database} description="Published, live, completed, and archived trips." /><DataCard title="Booking records" value={stats?.bookings.total ?? 0} icon={Users} description="Passenger reservations across all trips." /><DataCard title="Vehicle records" value={stats?.vehicles.total ?? 0} icon={UserRoundCheck} description={`${stats?.vehicles.pending ?? 0} currently pending verification.`} /><DataCard title="Alert records" value={stats?.alerts.total ?? 0} icon={AlertTriangle} description={`${stats?.alerts.open ?? 0} currently remain open.`} /><DataCard title="Realtime connections" value={stats?.stream.sockets ?? 0} icon={ShieldCheck} description="Active delivery sockets for live updates." /></div><section className={`${panelClass} overflow-hidden`}><div className="border-b border-line px-6 py-5"><h3 className="font-semibold">Platform data flow</h3><p className="mt-1 text-sm text-muted">Users and vehicles create trips; bookings, locations, and alerts are connected to those trips.</p></div><div className="grid gap-px bg-line md:grid-cols-4"><FlowStep step="1" title="Users" description="Drivers, passengers, and administrators" /><FlowStep step="2" title="Vehicles" description="Driver vehicle verification data" /><FlowStep step="3" title="Trips & bookings" description="Routes, seats, and ride requests" /><FlowStep step="4" title="Locations & alerts" description="Live tracking and safety events" /></div></section></div>; }

function UsersSection({ users, query, busy, onQueryChange, onUpdate }: { users: AdminUser[]; query: string; busy: string | null; onQueryChange: (value: string) => void; onUpdate: (user: AdminUser) => void }) { return <div className="space-y-6"><div><h2 className="font-display text-2xl font-bold">Users</h2><p className="mt-1 text-sm text-muted">Review account roles and manage access to the platform.</p></div><section className={panelClass}><div className="flex flex-col gap-4 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold">All accounts <span className="text-muted">({users.length})</span></p><input value={query} onChange={(event) => onQueryChange(event.target.value)} className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand-teal sm:max-w-xs" placeholder="Search name or phone" /></div><div className="table-wrap"><table className="table min-w-[760px]"><thead><tr><th>Account</th><th>Roles</th><th>Verification</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map((account) => { const isAdmin = account.roles.includes("admin"); const isBusy = busy === `user-${account.id}`; return <tr key={account.id}><td><p className="font-medium">{account.full_name || "Unnamed user"}</p><p className="text-xs text-muted">{account.phone || "No contact details"}</p></td><td><div className="flex flex-wrap gap-1">{account.roles.map((role) => <span className="rounded-full bg-brand-teal/10 px-2 py-0.5 text-xs text-brand-teal" key={role}>{role}</span>)}</div></td><td><span className={account.phone_verified ? "text-success" : "text-muted"}>{account.phone_verified ? "Verified" : "Unverified"}</span></td><td><span className={account.status === "active" ? "text-success" : "text-danger"}>{account.status}</span></td><td><Button size="sm" variant={account.status === "active" ? "danger" : "secondary"} disabled={isAdmin || isBusy} onClick={() => onUpdate(account)}>{isBusy ? "Updating…" : account.status === "active" ? "Suspend" : "Reactivate"}</Button></td></tr>; })}{users.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-muted">No matching users found.</td></tr>}</tbody></table></div></section></div>; }

function AlertsSection({ alerts, busy, onResolve }: { alerts: AdminAlert[]; busy: string | null; onResolve: (id: string) => void }) { return <div className="space-y-6"><div><h2 className="font-display text-2xl font-bold">Alerts</h2><p className="mt-1 text-sm text-muted">Resolve platform safety and operational alerts.</p></div><section className={panelClass}>{alerts.length ? <div className="divide-y divide-line">{alerts.map((alert) => <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between" key={alert.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold capitalize">{alert.type.replaceAll("_", " ")}</p><Severity severity={alert.severity} /></div><p className="mt-1 text-sm text-muted">{alert.driver_name ? `Driver: ${alert.driver_name} · ` : ""}{alert.source_name && alert.destination_name ? `${alert.source_name} → ${alert.destination_name}` : "Route details unavailable"}</p><p className="mt-1 text-xs text-muted">Reported {new Date(alert.created_at).toLocaleString()}</p></div><Button size="sm" variant="secondary" disabled={busy === `alert-${alert.id}`} onClick={() => onResolve(alert.id)}><Check className="h-4 w-4" />{busy === `alert-${alert.id}` ? "Resolving…" : "Resolve"}</Button></div>)}</div> : <Empty label="There are no open alerts." />}</section></div>; }
function VehiclesSection({ vehicles, busy, onVerify }: { vehicles: PendingVehicle[]; busy: string | null; onVerify: (id: string, decision: "verified" | "rejected") => void }) {
  return <div className="space-y-6"><div><h2 className="font-display text-2xl font-bold">Vehicle details &amp; approval</h2><p className="mt-1 text-sm text-muted">Review pending driver vehicles before they can be used to host trips.</p></div><section className={panelClass}><div className="border-b border-line p-5"><h3 className="font-semibold">Vehicle verification requests <span className="text-muted">({vehicles.length})</span></h3><p className="mt-1 text-xs text-muted">Only verified, active vehicles can be selected when a driver hosts a trip.</p></div>{vehicles.length ? <div className="divide-y divide-line">{vehicles.map((vehicle) => { const saving = busy === `vehicle-${vehicle.id}`; return <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between" key={vehicle.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{vehicle.make} {vehicle.model}{vehicle.year ? ` (${vehicle.year})` : ""}</p><span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">Pending verification</span></div><p className="mt-1 text-sm text-muted">Username: {vehicle.owner_name || "Driver"} · Phone: {vehicle.owner_phone || "Not provided"}</p><dl className="mt-3 grid gap-x-6 gap-y-1 text-sm text-muted sm:grid-cols-2"><div><dt className="inline font-medium text-ink">Plate:</dt><dd className="inline"> {vehicle.plate_no}</dd></div><div><dt className="inline font-medium text-ink">Seats:</dt><dd className="inline"> {vehicle.seats_total}</dd></div><div><dt className="inline font-medium text-ink">Fuel type:</dt><dd className="inline capitalize"> {vehicle.fuel_type}</dd></div><div><dt className="inline font-medium text-ink">Status:</dt><dd className="inline capitalize"> {vehicle.verification_status}</dd></div></dl></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="secondary" disabled={saving} onClick={() => onVerify(vehicle.id, "rejected")}>{saving ? "Saving…" : "Deny vehicle"}</Button><Button size="sm" disabled={saving} onClick={() => onVerify(vehicle.id, "verified")}>{saving ? "Saving…" : "Approve vehicle"}</Button></div></div>; })}</div> : <Empty label="There are no pending vehicle verification requests." />}</section></div>;
}

function RequestsSection({ drivers, tripRequests, busy, onDecide, onDecideTrip }: { drivers: AdminDriver[]; tripRequests: AdminTripRequest[]; busy: string | null; onDecide: (id: string, decision: "approved" | "rejected") => void; onDecideTrip: (id: string, decision: "approved" | "rejected") => void }) { return <div className="space-y-6"><div><h2 className="font-display text-2xl font-bold">Approval requests</h2><p className="mt-1 text-sm text-muted">Review driver applications and hosted trips before riders can book them.</p></div><section className={panelClass}><div className="border-b border-line p-5"><h3 className="font-semibold">Trip requests <span className="text-muted">({tripRequests.length})</span></h3><p className="mt-1 text-xs text-muted">Approved trips are published immediately and the driver receives an in-app notification.</p></div>{tripRequests.length ? <div className="divide-y divide-line">{tripRequests.map((trip) => <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between" key={trip.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{trip.source_name || "Unknown source"} → {trip.destination_name || "Unknown destination"}</p><span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">Pending trip approval</span></div><p className="mt-1 text-sm text-muted">Driver: {trip.driver.full_name}{trip.driver.phone ? ` · ${trip.driver.phone}` : ""}</p><p className="mt-1 text-xs text-muted">{trip.trip_type} · {trip.vehicle.make || "Vehicle"} {trip.vehicle.model || ""}{trip.vehicle.plate_no ? ` · ${trip.vehicle.plate_no}` : ""} · {trip.seats_offered} passenger seat(s) · {trip.depart_at ? new Date(trip.depart_at).toLocaleString() : "Departure unavailable"}</p><p className="mt-1 text-xs text-muted">{trip.distance_km != null ? `${trip.distance_km.toFixed(1)} km` : "Distance unavailable"}{trip.total_cost != null ? ` · Total ₹${trip.total_cost.toFixed(2)}` : ""}{trip.cost_per_seat != null ? ` · ₹${trip.cost_per_seat.toFixed(2)}/seat` : ""}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy === `trip-${trip.id}`} onClick={() => onDecideTrip(trip.id, "rejected")}>Reject trip</Button><Button size="sm" disabled={busy === `trip-${trip.id}`} onClick={() => onDecideTrip(trip.id, "approved")}><Check className="h-4 w-4" />{busy === `trip-${trip.id}` ? "Saving…" : "Approve trip"}</Button></div></div>)}</div> : <Empty label="No trip approval requests are pending." />}</section><section className={panelClass}><div className="border-b border-line p-5"><h3 className="font-semibold">Driver account requests <span className="text-muted">({drivers.length})</span></h3><p className="mt-1 text-xs text-muted">Approve or deny drivers before they can publish trips.</p></div>{drivers.length ? <div className="divide-y divide-line">{drivers.map((driver) => <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between" key={driver.id}><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{driver.full_name || "Unnamed driver"}</p><span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">Pending approval</span></div><p className="mt-1 text-sm text-muted">{driver.phone || "No phone provided"} · {driver.phone_verified ? "Phone verified" : "Phone unverified"}</p><p className="mt-1 text-xs text-muted">Vehicle: {driver.vehicle ? `${driver.vehicle.make} ${driver.vehicle.model} · ${driver.vehicle.plate_no}` : "No vehicle submitted"}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy === `driver-${driver.id}`} onClick={() => onDecide(driver.id, "rejected")}>Deny</Button><Button size="sm" disabled={busy === `driver-${driver.id}`} onClick={() => onDecide(driver.id, "approved")}><Check className="h-4 w-4" />{busy === `driver-${driver.id}` ? "Saving…" : "Approve"}</Button></div></div>)}</div> : <Empty label="No driver approval requests are pending." />}</section></div>; }

function DataCard({ title, value, icon: Icon, description }: { title: string; value: number; icon: React.ElementType; description: string }) { return <div className={`${panelClass} p-5`}><div className="flex items-start justify-between"><div><p className="text-sm text-muted">{title}</p><p className="mt-2 text-3xl font-bold">{value}</p></div><Icon className="h-5 w-5 text-brand-teal" /></div><p className="mt-3 text-xs text-muted">{description}</p></div>; }
function FlowStep({ step, title, description }: { step: string; title: string; description: string }) { return <div className="bg-surface p-6"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-teal/10 text-sm font-bold text-brand-teal">{step}</span><h4 className="mt-4 font-semibold">{title}</h4><p className="mt-1 text-sm text-muted">{description}</p></div>; }
function Severity({ severity }: { severity: string }) { const style = severity === "critical" ? "bg-danger/10 text-danger" : severity === "high" ? "bg-warn/10 text-warn" : "bg-brand-teal/10 text-brand-teal"; return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${style}`}>{severity}</span>; }
function Empty({ label }: { label: string }) { return <div className="p-10 text-center text-sm text-muted">{label}</div>; }
function LoadingWorkspace() { return <div className="space-y-5"><div className="h-8 w-52 animate-pulse rounded bg-card" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div className="h-36 animate-pulse rounded-2xl bg-card" key={index} />)}</div><div className="h-72 animate-pulse rounded-2xl bg-card" /></div>; }
