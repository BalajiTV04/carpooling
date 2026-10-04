"use client";
// /database page: ER-style data map + live index stats + schema explorer.
// Station timeline motif: collections as "stops" on the data line.
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDbStats, initDb, type DbStats } from "@/lib/db";
import { CollectionCard } from "@/components/CollectionCard";

const BLURBS: Record<string, string> = {
  users: "People. roles[] = driver / passenger / admin. Phone (E.164) is the login key.",
  vehicles: "Driver cars. plate_no unique. verified before trip publishing.",
  trips: "One drive: source → dest + LineString route, seats, UTC depart_at.",
  bookings: "One passenger request: pickup/dropoff Points + match + share.",
  segments: "Legs between stops. Module 13 splits cost per leg.",
  locations: "Driver GPS pings, active trips only. TTL auto-deletes after 30d.",
  safety_alerts: "SOS / speed / deviation events for the admin board."
};

const ORDER = ["users", "vehicles", "trips", "bookings", "segments", "locations", "safety_alerts"];

export default function DatabasePage() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [msg, setMsg] = useState("Backend not reached — showing Module 2 contract.");
  const load = () =>
    fetchDbStats().then((s) => {
      setStats(s);
      const missing = Object.values(s.collections).filter((c) => c.missing).length;
      setMsg(missing > 0 ? `${missing} collections missing — press Initialise.` : "Live from Mongo via /api/v1/db/stats.");
    });
  useEffect(() => { load(); }, []);

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-10">
      <Link href="/" className="text-sm text-volt-300">← VoltRide home</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Data map <span className="text-iris-300">· 7 stops</span></h1>
          <p className="mt-1 text-sm text-[#A5ABD6]">{msg} All coordinates GeoJSON [lng, lat]. Times UTC.</p>
        </div>
        <button
          onClick={async () => { setMsg("Initialising…"); await initDb(); await load(); }}
          className="rounded-full bg-volt-400 px-5 py-2 text-sm font-bold text-night-950 shadow-glow"
        >
          Initialise DB
        </button>
      </div>

      <div className="mt-6 hidden items-center gap-0 md:flex" aria-hidden>
        {ORDER.map((c, i) => (
          <div key={c} className="flex flex-1 items-center last:flex-none">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-iris-500 text-xs font-bold text-white">{i + 1}</div>
            {i < ORDER.length - 1 && <div className="h-0.5 flex-1 bg-gradient-to-r from-iris-500 to-volt-400/60" />}
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {ORDER.map((name) => {
          const row = stats?.collections[name];
          return (
            <CollectionCard
              key={name}
              name={name}
              blurb={BLURBS[name]}
              count={row ? row.count : null}
              indexes={row ? row.indexes : []}
              geo={row ? row.geo : []}
            />
          );
        })}
      </div>

      <div className="mt-6 rounded-xl3 border border-[rgba(198,255,74,.3)] bg-night-900/80 p-5 text-sm text-[#A5ABD6]">
        <span className="font-semibold text-volt-300">Why this shape?</span> Trips carry the
        LineString route so matching (Module 9) is a geo query, not string compare.
        Bookings store pickup/dropoff as Points so detour optimisation (Module 10) can
        rank them. Locations TTL away for privacy — tracking exists only inside active trips.
      </div>
    </main>
  );
}
