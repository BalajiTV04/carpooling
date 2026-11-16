"use client";
// /requests: ride requests to approve/reject as a driver.
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { bookingApi, type Booking } from "@/lib/bookings";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Car, Clock, Check, X, MapPin } from "lucide-react";

export default function RequestsPage() {
  return (
    <RequireAuth roles={["driver"]}>
      <RequestsInner />
    </RequireAuth>
  );
}

function RequestsInner() {
  const [requests, setRequests] = useState<Booking[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await bookingApi.incoming();
      setRequests(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const respond = async (id: string, decision: "accepted" | "rejected") => {
    setBusyId(id);
    setErr(null);
    try {
      if (decision === "accepted") {
        await bookingApi.accept(id);
      } else {
        await bookingApi.reject(id);
      }
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageShell
      title="Ride requests"
      eyebrow="Driver"
      subtitle="Approve or reject passenger requests for your trips."
    >
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 grid gap-4"
      >
        {requests.length === 0 && (
          <div className="glass-card p-8 text-center">
            <div className="mx-auto mb-3">
              <Clock className="h-8 w-8 text-muted/50" />
            </div>
            <h3 className="font-display font-bold text-ink mb-1">No pending requests</h3>
            <p className="text-sm text-muted">
              Passengers will request to join your trips here.
            </p>
          </div>
        )}
        {requests.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: requests.indexOf(r) * 0.05 }}
            whileHover={{ y: -2 }}
            className="glass-card p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Car className="h-4 w-4 text-brand-teal" />
                  <p className="truncate font-medium text-ink">{r.passenger_name ?? "A rider"}</p>
                </div>
                <p className="text-xs text-muted">
                  {r.trip?.source_name ?? "—"} → {r.trip?.destination_name ?? "—"} · {r.seats ?? 1} seat{r.seats !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.status === "requested" ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => respond(r.id, "accepted")}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      {busyId === r.id ? "Approving…" : "Approve / Accept"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => respond(r.id, "rejected")}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Reject
                    </Button>
                  </>
                ) : (
                  <Badge variant={r.status === "accepted" || r.status === "confirmed" ? "success" : "muted"}>
                    {r.status}
                  </Badge>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </PageShell>
  );
}