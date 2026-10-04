"use client";
// RateRideCard (Module 22): leave or edit a review for one completed ride.
// Used by the passenger (BookingPanel) and the driver (TripCard receipt), so
// both sides get the same prompt and the same rules.
import { useState } from "react";
import { ratingApi, type PendingRating } from "@/lib/ratings";
import { StarPicker } from "@/components/StarPicker";

export function RateRideCard({
  row, onRated
}: {
  row: PendingRating;
  onRated?: () => void;
}) {
  const [stars, setStars] = useState<number>(row.my_stars ?? 0);
  // Prefill with the existing comment so editing a score never silently
  // deletes what the rater already wrote.
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const editing = row.my_stars !== null;
  const route = row.trip
    ? `${row.trip.source_name ?? "?"} → ${row.trip.destination_name ?? "?"}`
    : "completed ride";

  const submit = async () => {
    if (stars < 1) { setErr("Pick a star rating first."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const saved = await ratingApi.rate({
        booking_id: row.booking_id, stars, comment: comment.trim() || undefined
      });
      setMsg(
        saved.target_rating_count !== undefined
          ? `Thanks! ${row.target_name ?? "They"} now sits at ★${
              saved.target_rating_avg ?? "–"} (${saved.target_rating_count}).`
          : "Thanks for rating!"
      );
      setComment("");
      onRated?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save the rating");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-2xl border border-[rgba(198,255,74,.3)] bg-night-950 p-3 text-[11px]">
      <p className="font-bold text-volt-300">
        {editing ? "Update your review" : "Rate this ride"}
        <span className="ml-1 font-normal text-[#A5ABD6]">
          {row.target_name ? `for ${row.target_name}` : ""} · {route}
        </span>
      </p>
      <p className="text-[#5b6194]">
        Only the other party is rated, and one person gets one vote per ride.
      </p>
      <div className="mt-1.5">
        <StarPicker value={stars} onChange={setStars} disabled={busy} />
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Optional note (max 500 chars)"
        className="mt-1.5 w-full resize-none rounded-xl border border-[rgba(154,151,255,.3)] bg-night-950 px-2 py-1.5 text-[11px]"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={submit} disabled={busy}
          className="rounded-full bg-volt-400 px-3 py-1 font-bold text-night-950 disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Update review" : "Submit rating"}
        </button>
        {editing && (
          <span className="text-[#5b6194]">you rated ★{row.my_stars}</span>
        )}
      </div>
      {msg && <p className="mt-1 text-volt-300">{msg}</p>}
      {err && <p className="mt-1 text-rose-300">{err}</p>}
    </div>
  );
}