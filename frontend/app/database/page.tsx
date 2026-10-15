"use client";
// /database page: ER-style data map + live index stats + schema explorer.
// Station timeline motif: collections as "stops" on the data line.
import { useEffect, useState } from "react";
import { fetchDbStats, initDb, type DbStats } from "@/lib/db";
import { CollectionCard } from "@/components/CollectionCard";
import { PageShell } from "@/components/PageShell";

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
    <PageShell
      title="Data map"
      eyebrow="Admin · Module 2"
      accent="· 7 stops"
      wide
      subtitle={<>{msg} All coordinates GeoJSON [lng, lat]. Times UTC.</>}
      actions={
        <button
          onClick={async () => { setMsg("Initialising…"); await initDb(); await load(); }}
          className="btn btn-primary"
        >
          Initialise DB
        </button>
      }
    >
      <div className="mt-6 hidden items-center gap-0 md:flex" aria-hidden>
        {ORDER.map((c, i) => (
          <div key={c} className="flex flex-1 items-center last:flex-none">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-iris-500 text-xs font-bold text-white">{i + 1}</div>
            {i < ORDER.length - 1 && <div className="roadline flex-1 rounded-full opacity-70" />}
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

      <div className="panel mt-6 border-volt-400/30 p-5 text-sm text-muted">
        <span className="font-semibold text-volt-300">Why this shape?</span> Trips carry the
        LineString route so matching (Module 9) is a geo query, not string compare.
        Bookings store pickup/dropoff as Points so detour optimisation (Module 10) can
        rank them. Locations TTL away for privacy — tracking exists only inside active trips.
      </div>
    </PageShell>
  );
}
