"use client";
// /requests (Module 11): two role-aware panes — my requests (passenger side)
// and incoming requests (driver side, accept/reject). Distinct layout logic
// per role per the brief; no generic CRUD table.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/components/SessionProvider";
import {
  bookingApi, statusPillCls, type Booking
} from "@/lib/bookings";
import { RateRideCard } from "@/components/RateRideCard";
import { ratingApi, type PendingRating } from "@/lib/ratings";

/** Module 22 prompt for one completed booking, fed by the pending list. */
function RateBookingRow({ bookingId }: { bookingId: string }) {
  const [row, setRow] = useState<PendingRating | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    ratingApi.pending()
      .then((p) => {
        setRow(p.items.find((i) => i.booking_id === bookingId) ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [bookingId]);
  if (!loaded || !row) return null;
  return <RateRideCard row={row} />;
}

export default function RequestsPage() {
  return (
    <RequireAuth>
      <RequestsInner />
    </RequireAuth>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  });
}

function RequestsInner() {
  const { user } = useSession();
  const isDriver = !!user?.roles.includes("driver");
  const [tab, setTab] = useState<"mine" | "incoming">("mine");
  const [mine, setMine] = useState<Booking[]>([]);
  const [incoming, setIncoming] = useState<Booking[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setMine(await bookingApi.mine());
      if (isDriver) setIncoming(await bookingApi.incoming());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, [isDriver]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<Booking>, ok: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const Card = ({ b, incomingView }: { b: Booking; incomingView: boolean }) => (
    <div className="rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display font-bold">
            {b.trip?.source_name ?? "?"} → {b.trip?.destination_name ?? "?"}
          </p>
          <p className="text-xs text-[#A5ABD6]">
            {b.trip ? `${fmt(b.trip.depart_at)} · ${b.trip.vehicle ?? "car"}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-[#A5ABD6]">
            {incomingView
              ? `${b.passenger_name ?? "Passenger"} · ${b.seats} seat${b.seats > 1 ? "s" : ""}`
              : `driver ${b.driver_name ?? "—"} · ${b.seats} seat${b.seats > 1 ? "s" : ""}`}
            {b.detour_km !== null && ` · detour ${b.detour_km} km`}
            {b.pickup_distance_m !== null && ` · walk ${Math.round(b.pickup_distance_m)} m`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${statusPillCls(b.status)}`}>
          {b.status}
        </span>
      </div>
      <div className="mt-3 flex gap-1.5 text-xs">
        {incomingView && b.status === "requested" && (
          <>
            <button onClick={() => act(() => bookingApi.accept(b.id), "Accepted ✓")}
              disabled={busy}
              className="rounded-full bg-volt-400 px-3 py-1.5 font-bold text-night-950">
              Accept
            </button>
            <button onClick={() => act(() => bookingApi.reject(b.id), "Rejected — seats released.")}
              disabled={busy}
              className="rounded-full border border-rose-400/50 px-3 py-1.5 text-rose-300">
              Reject
            </button>
          </>
        )}
        {!incomingView && b.status === "accepted" && (
          <button onClick={() => act(() => bookingApi.confirm(b.id), "Booked ✓")}
            disabled={busy}
            className="rounded-full bg-volt-400 px-3 py-1.5 font-bold text-night-950">
            Confirm ✓
          </button>
        )}
        {b.status === "completed" && (
          <>
            <p className="mt-2 text-[11px] text-volt-300">
              Rode ✓{b.cost_share !== null ? ` · settled ₹${b.cost_share}` : ""}. Money frozen at completion.
            </p>
            {/* Module 22: the rating prompt the Module 23 bell links to. */}
            {!incomingView && <RateBookingRow bookingId={b.id} />}
          </>
        )}
        {["requested", "accepted", "confirmed"].includes(b.status) && (
          <button onClick={() => act(() => bookingApi.cancel(b.id), "Cancelled — seats released.")}
            disabled={busy}
            className="rounded-full border border-rose-400/50 px-3 py-1.5 text-rose-300">
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  const list = tab === "mine" ? mine : incoming;

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20 pt-10">
      <Link href="/" className="text-sm text-volt-300">← VoltRide</Link>
      <h1 className="font-display mt-2 text-3xl font-bold">Requests</h1>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setTab("mine")}
          className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "mine" ? "bg-volt-400 text-night-950" : "border border-[rgba(154,151,255,.35)] text-[#A5ABD6]"}`}
        >
          My requests ({mine.length})
        </button>
        {isDriver && (
          <button
            onClick={() => setTab("incoming")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "incoming" ? "bg-iris-500 text-white" : "border border-[rgba(154,151,255,.35)] text-[#A5ABD6]"}`}
          >
            Incoming ({incoming.length})
          </button>
        )}
      </div>
      {err && <p className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      <div className="mt-4 grid gap-3">
        {list.length === 0 && (
          <div className="rounded-xl3 border border-dashed border-[rgba(154,151,255,.35)] p-8 text-center text-sm text-[#A5ABD6]">
            {tab === "mine"
              ? <>No requests yet — find a ride in <Link href="/search" className="text-volt-300">/search</Link> and tap Request booking.</>
              : "No incoming requests yet. Publish trips and they will appear here."}
          </div>
        )}
        {list.map((b) => <Card key={b.id} b={b} incomingView={tab === "incoming"} />)}
      </div>
    </main>
  );
}