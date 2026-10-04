"use client";
// BookingPanel: passenger-side booking block inside a ride card drawer.
// States: no booking -> seats + request button; requested -> waiting (+cancel);
// accepted -> confirm; confirmed -> locked-in; rejected/cancelled -> re-request.
import { useEffect, useState } from "react";
import {
  bookingApi, statusPillCls, type Booking, type BookingStatus
} from "@/lib/bookings";
import { costApi, type BookingCost } from "@/lib/cost";
import { SegmentView } from "@/components/SegmentView";
import { LiveTrack } from "@/components/LiveTrack";
import { SafetyBanner } from "@/components/SafetyBanner";
import { RateRideCard } from "@/components/RateRideCard";
import { ratingApi, type PendingRating } from "@/lib/ratings";
import type { PlaceHit } from "@/lib/geo";

/** Module 22: looks this booking up in my pending list and renders the prompt.
 *  The API already resolves the OTHER party, so no target is passed in. */
function RateRideRow({ bookingId }: { bookingId: string }) {
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

function CostStrip({ bookingId, bookingCost, tripId }: {
  bookingId: string; bookingCost: number | null; tripId: string;
}) {
  const [detail, setDetail] = useState<BookingCost | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    costApi.booking(bookingId).then(setDetail).catch(() => setDetail(null));
  }, [bookingId]);
  const share = detail?.your_share ?? bookingCost;
  if (share === null || share === undefined) return null;
  return (
    <>
      <p className="mt-1.5 rounded-2xl border border-[rgba(198,255,74,.3)] bg-night-900 px-3 py-2 text-[11px]">
        <span className="font-display text-sm font-bold text-volt-300">₹{share}</span>
        <span className="text-[#A5ABD6]">
          {" "}your share{detail ? ` · ${detail.formula}` : ""}
        </span>
        <button onClick={() => setOpen(!open)} className="ml-2 text-volt-300 underline">
          {open ? "hide" : "why?"}
        </button>
      </p>
      {/* Module 12: the rider sees the WHOLE arithmetic, not just their slice —
          which car, what mileage, what fuel price produced total_cost. */}
      {open && detail && (
        <div className="mt-1.5 rounded-2xl bg-night-900 p-2.5 text-[11px]">
          <p className="truncate text-[#EEF0FF]">
            <span className="font-semibold">
              {detail.vehicle?.make ?? "Car"} {detail.vehicle?.model ?? ""}
            </span>
            {detail.vehicle?.year ? <span className="text-[#A5ABD6]"> · {detail.vehicle.year}</span> : null}
            {detail.vehicle?.plate_no ? <span className="font-mono text-volt-300"> · {detail.vehicle.plate_no}</span> : null}
          </p>
          <p className="mt-0.5 text-[#A5ABD6]">
            {detail.vehicle?.fuel_type ?? "fuel"} ·{" "}
            <span className="font-semibold text-volt-300">{detail.fuel?.mileage_kmpl} kmpl</span>
            {" · "}₹{detail.fuel?.fuel_price}/L
          </p>
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[#5b6194]">
            {detail.fuel?.distance_km} km ÷ {detail.fuel?.mileage_kmpl} kmpl = {detail.fuel?.litres} L
            {" × "}₹{detail.fuel?.fuel_price} ={" "}
            <span className="text-volt-300">₹{detail.fuel?.total_cost}</span>
          </p>
          <p className="mt-1 text-[10px] text-[#5b6194]">
            split · <span className="text-[#A5ABD6]">{detail.formula}</span> →{" "}
            <span className="font-semibold text-volt-300">₹{detail.your_share}</span>
          </p>
        </div>
      )}
      {/* Module 13: which legs you are paying for */}
      {open && <SegmentView tripId={tripId} />}
    </>
  );
}

function CostPreview({ tripId }: { tripId: string }) {
  const [projected, setProjected] = useState<number | null>(null);
  const [mode, setMode] = useState<string>("");
  useEffect(() => {
    costApi.trip(tripId)
      .then((c) => { setProjected(c.projected_share_if_book_1_seat_now); setMode(c.policy.mode); })
      .catch(() => setProjected(null));
  }, [tripId]);
  if (projected === null || projected === 0) return null;
  return (
    <p className="mt-1.5 text-[11px] text-[#A5ABD6]">
      Est. share if you book now: <span className="font-bold text-volt-300">₹{projected}</span>
      <span className="text-[#5b6194]"> ({mode.replace("_", " ")})</span>
    </p>
  );
}

export function BookingPanel({
  tripId, seatsLeft, pickupHint, dropHint
}: {
  tripId: string;
  seatsLeft: number;
  pickupHint: PlaceHit | null;
  dropHint: PlaceHit | null;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    bookingApi.mine()
      .then((all) => {
        // Active states drive the action buttons; "completed" is included so a
        // rider returning to a finished trip sees the settled receipt instead
        // of a dead "request booking" button (Module 19).
        const mine = all.find(
          (b) => b.trip_id === tripId &&
            ["requested", "accepted", "confirmed", "completed"].includes(b.status)
        );
        setBooking(mine ?? null);
      })
      .catch(() => setBooking(null))
      .finally(() => setChecked(true));
  }, [tripId]);

  const act = async (fn: () => Promise<Booking>, ok: string) => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      setBooking(await fn());
      setMsg(ok);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const request = async () => {
    if (!pickupHint || !dropHint) {
      setErr("Search From and To first — those are your pickup/drop points.");
      return;
    }
    await act(
      () => bookingApi.create({
        trip_id: tripId, seats,
        pickup_coordinates: [pickupHint.lng, pickupHint.lat],
        dropoff_coordinates: [dropHint.lng, dropHint.lat],
        use_optimised_pickup: true
      }),
      "Request sent — the driver will accept or reject it."
    );
  };

  const s: BookingStatus | null = booking?.status ?? null;
  const canRequest = checked && booking === null;

  return (
    <div className="mt-3 rounded-2xl border border-[rgba(154,151,255,.3)] bg-night-950 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-[#EEF0FF]">Booking</p>
        {s && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${statusPillCls(s)}`}>
            {s}
          </span>
        )}
      </div>

      {msg && <p className="mt-2 rounded-2xl border border-volt-400/40 bg-volt-400/10 p-2 text-[11px] text-volt-300">{msg}</p>}
      {err && <p className="mt-2 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">{err}</p>}

      {canRequest && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={seats} onChange={(e) => setSeats(Number(e.target.value))}
            className="rounded-2xl border border-[rgba(154,151,255,.3)] bg-night-950 px-3 py-2 text-sm"
            disabled={seatsLeft < 1}
          >
            {Array.from({ length: Math.max(1, Math.min(7, seatsLeft)) }, (_, i) => i + 1)
              .map((n) => <option key={n} value={n}>{n} seat{n > 1 ? "s" : ""}</option>)}
          </select>
          <button
            onClick={request} disabled={busy || seatsLeft < 1}
            className="flex-1 rounded-2xl bg-volt-400 py-2 text-xs font-bold text-night-950 shadow-glow disabled:opacity-50"
          >
            {seatsLeft < 1 ? "No seats left" : busy ? "Requesting…" : "Request booking →"}
          </button>
        </div>
      )}

      {s === "requested" && booking && (
        <p className="mt-2 text-[11px] text-[#A5ABD6]">
          Waiting for the driver. Seats are held for you.
          <button onClick={() => act(() => bookingApi.cancel(booking.id), "Request cancelled.")}
            className="ml-2 text-rose-300 underline" disabled={busy}>cancel</button>
        </p>
      )}
      {s === "accepted" && booking && (
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 text-[11px] text-iris-300">Driver accepted — confirm to lock it in.</p>
          <button onClick={() => act(() => bookingApi.confirm(booking.id), "Booked! See you at the pickup point.")}
            className="rounded-full bg-volt-400 px-3 py-1 text-[11px] font-bold text-night-950" disabled={busy}>
            Confirm ✓
          </button>
          <button onClick={() => act(() => bookingApi.cancel(booking.id), "Cancelled.")}
            className="text-[11px] text-rose-300 underline" disabled={busy}>cancel</button>
        </div>
      )}
      {s === "confirmed" && booking && (
        <>
          <p className="mt-2 text-[11px] text-volt-300">
            Booked ✓ · {booking.seats} seat{booking.seats > 1 ? "s" : ""}
            {booking.detour_km !== null ? ` · driver detour ${booking.detour_km} km` : ""}
            {booking.pickup_distance_m !== null ? ` · walk ${Math.round(booking.pickup_distance_m)} m` : ""}
            <button onClick={() => act(() => bookingApi.cancel(booking.id), "Cancelled — seats released.")}
              className="ml-2 text-rose-300 underline" disabled={busy}>cancel</button>
          </p>
          <CostStrip bookingId={booking.id} bookingCost={booking.cost_share} tripId={tripId} />
          <LiveTrack tripId={tripId} />
          <SafetyBanner tripId={tripId} driverId={undefined} />
        </>
      )}
      {s === "completed" && booking && (
        <>
          <p className="mt-2 text-[11px] text-volt-300">
            Rode ✓ · {booking.seats} seat{booking.seats > 1 ? "s" : ""}
            {booking.cost_share !== null ? ` · settled ₹${booking.cost_share}` : ""}
            {booking.closure_note ? " · trip completed" : ""}
            <span className="text-[#5b6194]"> · money frozen at completion</span>
          </p>
          {/* Module 22: the trust prompt rides on the completed state. */}
          <RateRideRow bookingId={booking.id} />
        </>
      )}
      {(s === "accepted" || s === "requested") && (
        <CostPreview tripId={tripId} />
      )}
      {(s === "rejected" || s === "cancelled") && (
        <p className="mt-2 text-[11px] text-[#A5ABD6]">
          This booking was {s}. Seats were released — you can request again.
          <button onClick={request} className="ml-2 text-volt-300 underline" disabled={busy}>request again</button>
        </p>
      )}
    </div>
  );
}