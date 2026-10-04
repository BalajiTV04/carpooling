// Safety banner: SOS panic button + open-alert feed (polls with LiveTrack).
// Visible to the whole trip audience; ack is driver-only.
"use client";
import { useEffect, useState } from "react";
import { safetyApi, severityCls, type SafetyAlert } from "@/lib/safety";
import { useSession } from "@/components/SessionProvider";

function label(a: SafetyAlert) {
  if (a.type === "sos") return "🆘 SOS — help requested";
  if (a.type === "speed") {
    const d = (a.details ?? {}) as { speed_kmph?: number; limit_kmph?: number };
    return `⚠ Over-speed ${d.speed_kmph ?? "?"} km/h (limit ${d.limit_kmph ?? 80})`;
  }
  const d = (a.details ?? {}) as { deviation_m?: number };
  return `🧭 Off-route ${d.deviation_m !== undefined ? `${Math.round(Number(d.deviation_m))} m` : ""}`;
}

export function SafetyBanner({ tripId, driverId, isDriverForce }: { tripId: string; driverId?: string; isDriverForce?: boolean }) {
  const { user } = useSession();
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const [open, setOpen] = useState(0);
  const [sosMsg, setSosMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const isDriver = isDriverForce === true || (!!user && !!driverId && user.id === driverId);

  const load = async () => {
    try {
      const f = await safetyApi.trip(tripId);
      setAlerts(f.alerts);
      setOpen(f.open);
    } catch { /* audience-gated: hide banner when not on this trip */ }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const sos = async () => {
    setBusy(true);
    setNote(null);
    try {
      await safetyApi.sos(tripId, sosMsg || undefined);
      setSosMsg("");
      setNote("SOS sent — the driver and support can see your live location.");
      await load();
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "SOS failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-2xl border border-[rgba(154,151,255,.25)] bg-night-950 p-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold text-[#EEF0FF]">
          Safety {open > 0 && <span className="ml-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-200">{open} open</span>}
        </p>
        <div className="ml-auto flex gap-1.5">
          <input
            value={sosMsg}
            onChange={(e) => setSosMsg(e.target.value)}
            placeholder="SOS note (optional)"
            className="w-32 rounded-full border border-[rgba(154,151,255,.3)] bg-night-900 px-2.5 py-1 text-[11px] text-[#EEF0FF]"
          />
          <button
            onClick={sos} disabled={busy}
            className="rounded-full bg-rose-500 px-3 py-1 text-[11px] font-bold text-white"
          >
            {busy ? "…" : "🆘 SOS"}
          </button>
        </div>
      </div>
      {note && <p className="mt-1.5 text-[11px] text-[#A5ABD6]">{note}</p>}
      {alerts.length > 0 && (
        <ul className="mt-2 grid gap-1.5">
          {alerts.slice(0, 5).map((a) => (
            <li key={a.id} className={`flex items-center gap-2 rounded-2xl px-2.5 py-1.5 text-[11px] ${severityCls(a.severity)}`}>
              <span className="min-w-0 flex-1 truncate">{label(a)} · {a.status}</span>
              {isDriver && a.status === "open" && (
                <button
                  onClick={async () => { await safetyApi.ack(a.id); await load(); }}
                  className="shrink-0 rounded-full border border-current px-2 py-0.5 text-[10px] font-bold"
                >
                  Acknowledge
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
