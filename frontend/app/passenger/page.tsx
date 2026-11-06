"use client";
// /passenger: upcoming bookings + ride history for riders.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Car, MapPin, Clock } from "lucide-react";

export default function PassengerPage() {
  return (
    <RequireAuth roles={["passenger"]}>
      <PassengerInner />
    </RequireAuth>
  );
}

function PassengerInner() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch("/api/v1/bookings/mine");
      if (!r.ok) throw new Error("Load failed");
      const data = await r.json();
      setBookings(data.bookings ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id: string) => {
    if (!confirm("Cancel this booking?")) return;
    try {
      await fetch(`/api/v1/bookings/${id}/cancel`, { method: "POST" });
      setBookings(bookings.map((b) => b.id === id ? { ...b, status: "cancelled" } : b));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    }
  };

  return (
    <PageShell
      title="My rides"
      eyebrow="Passenger"
      subtitle="Your upcoming trips and ride history."
    >
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 grid gap-4"
      >
        {bookings.length === 0 && (
          <div className="glass-card p-8 text-center">
            <div className="mx-auto mb-3">
              <Car className="h-8 w-8 text-muted/50" />
            </div>
            <h3 className="font-display font-bold text-ink mb-1">No rides yet</h3>
            <p className="text-sm text-muted">
              Find your first ride in <Link href="/search" className="text-brand-teal font-medium hover:underline">Find a ride</Link>.
            </p>
          </div>
        )}
        {bookings.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: bookings.indexOf(b) * 0.05 }}
            whileHover={{ y: -2 }}
            className="glass-card p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="h-4 w-4 text-brand-teal" />
                  <p className="truncate font-medium text-ink">{b.source_name ?? "—"} → {b.destination_name ?? "—"}</p>
                </div>
                <p className="text-xs text-muted">
                  {b.depart_at ?? "—"} · {b.seats ?? 1} seat{b.seats !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={b.status === "confirmed" ? "success" : "muted"} className="text-[10px]">
                  {b.status}
                </Badge>
                {b.status === "confirmed" && (
                  <Button variant="danger" size="sm" onClick={() => cancel(b.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </PageShell>
  );
}