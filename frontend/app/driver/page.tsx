"use client";
// /driver: live trip tracking + safety for the active driver.
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Car, MapPin, Shield, Clock, Users } from "lucide-react";

export default function DriverPage() {
  return (
    <RequireAuth roles={["driver"]}>
      <DriverInner />
    </RequireAuth>
  );
}

function DriverInner() {
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const startLive = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/v1/tracking/start", { method: "POST" });
      if (!r.ok) throw new Error("Start failed");
      setLive(true);
      setMsg("Live tracking started ✓");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const stopLive = async () => {
    setBusy(true);
    try {
      await fetch("/api/v1/tracking/stop", { method: "POST" });
      setLive(false);
      setMsg("Live tracking stopped.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Driver console"
      eyebrow="Driver"
      subtitle="Track your trip, share ETA, and stay safe on the road."
    >
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}
      {msg && <Alert variant="success" className="mt-6">{msg}</Alert>}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 glass-card p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-bold text-ink">Live tracking</h2>
            <p className="text-sm text-muted">
              Broadcast your location so riders can follow your ETA.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={live ? "danger" : "primary"}
              size="md"
              disabled={busy}
              onClick={live ? stopLive : startLive}
            >
              {busy ? (live ? "Stopping…" : "Starting…") : live ? "Stop tracking" : "Start tracking"}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <Car className="h-5 w-5 text-muted" />
              <p className="text-sm font-medium text-ink">{live ? "Active" : "Idle"}</p>
            </div>
            <p className="mt-1 text-xs text-muted">
              {live ? "Your location is being shared." : "Not sharing location yet."}
            </p>
          </div>
          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted" />
              <p className="text-sm font-medium text-ink">Safety mode</p>
            </div>
            <p className="mt-1 text-xs text-muted">
              Tap the panic button to alert emergency contacts.
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mt-6 glass-card p-6"
      >
        <h2 className="font-display font-bold text-ink mb-4">Quick actions</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Button variant="ghost" size="md" className="w-full">
            <MapPin className="mr-2 h-4 w-4" />
            Set pickup point
          </Button>
          <Button variant="ghost" size="md" className="w-full">
            <Clock className="mr-2 h-4 w-4" />
            Update ETA
          </Button>
          <Button variant="ghost" size="md" className="w-full">
            <Users className="mr-2 h-4 w-4" />
            Message riders
          </Button>
        </div>
      </motion.div>
    </PageShell>
  );
}