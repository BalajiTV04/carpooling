"use client";
// /database (Module 23): admin data map + initialise DB tool.
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { MapPin, Database, Zap } from "lucide-react";

export default function DatabasePage() {
  return (
    <RequireAuth roles={["admin"]}>
      <DatabaseInner />
    </RequireAuth>
  );
}

function DatabaseInner() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const initDb = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/db_admin/init", { method: "POST" });
      if (!r.ok) throw new Error("Init failed");
      setMsg("Database initialised ✓");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Init failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Data map"
      eyebrow="Admin · Module 23"
      subtitle="Inspect and seed the platform database."
      wide
    >
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}
      {msg && <Alert variant="success" className="mt-6">{msg}</Alert>}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 grid gap-6 md:grid-cols-3"
      >
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Database className="h-6 w-6 text-brand-teal" />
            <h2 className="font-display font-bold text-ink">Database</h2>
          </div>
          <p className="text-sm text-muted mb-6">
            Seed demo users, vehicles, trips and bookings for local development.
          </p>
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            onClick={initDb}
            className="w-full"
          >
            {busy ? "Initialising…" : "Initialise DB"}
          </Button>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <MapPin className="h-6 w-6 text-brand-teal" />
            <h2 className="font-display font-bold text-ink">Live map</h2>
          </div>
          <p className="text-sm text-muted mb-6">
            View active trips and vehicle locations on the map.
          </p>
          <Button variant="ghost" size="md" className="w-full">
            Open map
          </Button>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="h-6 w-6 text-brand-teal" />
            <h2 className="font-display font-bold text-ink">Stream</h2>
          </div>
          <p className="text-sm text-muted mb-6">
            Monitor live location pushes and socket events.
          </p>
          <Button variant="ghost" size="md" className="w-full">
            View stream
          </Button>
        </div>
      </motion.div>
    </PageShell>
  );
}