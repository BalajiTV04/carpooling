"use client";
// /admin (Module 21): live operations console.
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Shield, Car, Users, Clock } from "lucide-react";

function StatCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="glass-card p-5">
      <p className="text-[11px] uppercase tracking-[.15em] text-muted">{label}</p>
      <p className="font-display text-2xl font-bold text-brand-teal">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

function AdminInner() {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [trips, setTrips] = useState<any[]>([]);
  const [liveOnly, setLiveOnly] = useState(true);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [pendingCars, setPendingCars] = useState<any[]>([]);
  const [tab, setTab] = useState<"users" | "trips" | "cars" | "alerts">("alerts");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, t, a] = await Promise.all([
        (globalThis as any).fetch ? fetch("/api/v1/admin/stats").then(r => r.json()) : Promise.resolve(null),
        fetch("/api/v1/admin/trips?live_only=" + liveOnly).then(r => r.json()),
        fetch("/api/v1/admin/alerts?status=open").then(r => r.json()),
      ]);
      setStats(s?.[0]);
      setTrips(t?.[1]?.trips ?? []);
      setAlerts(a?.[2]?.alerts ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Console load failed");
    }
  }, [liveOnly]);

  useEffect(() => { load(); }, [load]);

  const cn = (...c: (string | undefined | null)[]) => c.filter(Boolean).join(" ");

  return (
    <PageShell
      title="Operations console"
      eyebrow="Admin · Module 21"
      subtitle="Who is on the road, who needs attention, who breaks the rules."
      wide
    >
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}
      {msg && <Alert variant="success" className="mt-6">{msg}</Alert>}

      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4"
        >
          <StatCard label="Live trips" value={stats.trips?.live ?? "—"} note={`${stats.trips?.total ?? "—"} total`} />
          <StatCard label="Users" value={stats.users?.total ?? "—"} note={`${stats.users?.active ?? "—"} active`} />
          <StatCard label="Vehicles" value={stats.vehicles?.total ?? "—"} note={`${stats.vehicles?.verified ?? "—"} verified`} />
          <StatCard label="Open alerts" value={stats.alerts?.open ?? "—"} note={stats.alerts?.critical_open > 0 ? `${stats.alerts.critical_open} critical` : "none critical"} />
        </motion.div>
      )}

      <div className="mt-8 flex gap-1">
        {["alerts", "trips", "cars", "users"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={cn(
              "px-4 py-2 rounded-xl font-medium text-sm transition-colors",
              tab === t
                ? "bg-gradient-indigo-teal text-white shadow-sm shadow-glow-brand"
                : "text-muted hover:text-brand-teal hover:bg-surface/50"
            )}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
    </PageShell>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminInner />
    </RequireAuth>
  );
}