"use client";
// /analytics (Module 24): sustainability, demand forecast, model evaluation.
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { useSession } from "@/components/SessionProvider";
import {
  analyticsApi, type Demand, type Evaluation, type Impact, type MyImpact
} from "@/lib/analytics";
import { Alert } from "@/components/ui/Alert";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card p-5">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-2xl font-bold text-brand-teal">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function ImpactPanel({ title, imp }: { title: string; imp: Impact }) {
  return (
    <section className="glass-card p-6">
      <h2 className="font-display font-bold text-ink mb-4">{title}</h2>
      {imp.trips === 0 ? (
        <p className="mt-2 text-sm text-muted">No completed rides to measure yet.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="km avoided" value={`${imp.km_avoided}`} sub={`${imp.solo_km} solo vs ${imp.shared_km} driven`} />
            <Stat label="vehicles avoided" value={`${imp.vehicles_avoided}`} sub={`${imp.riders} riders`} />
            <Stat label="CO2 avoided" value={`${imp.co2_avoided_kg} kg`} sub="direct emissions" />
            <Stat label="fuel saved" value={`${imp.fuel_saved_l} L`} />
            <Stat label="money saved" value={`₹${imp.cost_saved}`} sub={`paid ₹${imp.paid_total} of ₹${imp.solo_cost_total} solo`} />
            <Stat label="seats shared" value={`${imp.seats_shared}`} />
            <Stat label="worse than solo" value={`${imp.unfavourable_riders}`} sub="riders who paid more than alone" />
            <Stat label="trips" value={`${imp.trips}`} />
          </div>
          {Object.keys(imp.by_fuel).length > 0 && (
            <table className="mt-6 w-full text-[11px]">
              <thead className="text-muted">
                <tr className="text-left border-b border-line">
                  <th className="py-2 text-left">fuel</th>
                  <th className="py-2 text-left">trips</th>
                  <th className="py-2 text-left">km</th>
                  <th className="py-2 text-left">CO2 kg</th>
                  <th className="py-2 text-left">cars</th>
                </tr>
              </thead>
              <tbody className="text-muted divide-y divide-line">
                {Object.entries(imp.by_fuel).map(([f, v]) => (
                  <tr key={f} className="text-ink">
                    <td className="py-2">{f}</td>
                    <td className="py-2">{v.trips}</td>
                    <td className="py-2">{v.km_avoided}</td>
                    <td className="py-2">{v.co2_avoided_kg}</td>
                    <td className="py-2">{v.vehicles_avoided}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-[10px] text-muted">
            {imp.emission_basis} · {imp.note}
          </p>
        </>
      )}
    </section>
  );
}
function DemandPanel({ d }: { d: Demand }) {
  const D = d as any;
  return (
    <section className="glass-card p-6">
      <h2 className="font-display font-bold text-ink mb-4">Demand forecast</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Today" value={`${D.today_rides}`} sub="predicted rides" />
        <Stat label="Tomorrow" value={`${D.tomorrow_rides}`} sub="predicted rides" />
        <Stat label="Peak hour" value={`${D.peak_hour}:00`} sub="highest demand" />
        <Stat label="Avg wait" value={`${D.avg_wait_min} min`} sub="estimated" />
      </div>
    </section>
  );
}

function ScoreRow({ name, m }: { name: string; m: any }) {
  return (
    <tr className="text-ink border-b border-line">
      <td className="py-2">{name}</td>
      <td className="py-2">{m?.score ?? "—"}</td>
      <td className="py-2">{m?.n ?? "—"}</td>
      <td className="py-2">{m?.auc?.toFixed(3) ?? "—"}</td>
      <td className="py-2">{m?.precision?.toFixed(2) ?? "—"}</td>
      <td className="py-2">{m?.recall?.toFixed(2) ?? "—"}</td>
      <td className="py-2">{m?.f1?.toFixed(2) ?? "—"}</td>
    </tr>
  );
}

function EvalPanel({ e }: { e: Evaluation }) {
  return (
    <section className="glass-card p-6">
      <h2 className="font-display font-bold text-ink mb-4">Rule vs AI evaluation</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted">
            <tr className="text-left border-b border-line">
              <th className="py-2 text-left">Model</th>
              <th className="py-2 text-left">Score</th>
              <th className="py-2 text-left">N</th>
              <th className="py-2 text-left">AUC</th>
              <th className="py-2 text-left">Prec</th>
              <th className="py-2 text-left">Recall</th>
              <th className="py-2 text-left">F1</th>
            </tr>
          </thead>
          <tbody className="text-muted divide-y divide-line">
            <ScoreRow name="Module 9 rule" m={e.rule_score} />
            <ScoreRow name="Module 16 AI" m={e.ai_score} />
          </tbody>
        </table>
      </div>
      {e.offline_ranker_auc && (
        <p className="mt-4 text-[11px] text-muted">
          Offline AUC on the labelled training set ({e.deployed_model} deployed):
          {" "}
          {Object.entries(e.offline_ranker_auc).map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
      )}
      <p className="mt-2 text-[10px] text-muted">{e.caveat}</p>
    </section>
  );
}
export default function AnalyticsPage() {
  return (
    <RequireAuth>
      <AnalyticsInner />
    </RequireAuth>
  );
}

function AnalyticsInner() {
  const { user } = useSession();
  const isAdmin = !!user?.roles.includes("admin");
  const [mine, setMine] = useState<MyImpact | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [demand, setDemand] = useState<Demand | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const tasks: Promise<unknown>[] = [analyticsApi.mine().then(setMine)];
    if (isAdmin) {
      tasks.push(analyticsApi.impact().then(setImpact).catch(() => undefined));
      tasks.push(analyticsApi.demand().then(setDemand).catch(() => undefined));
      tasks.push(analyticsApi.evaluation().then(setEvaluation).catch(() => undefined));
    }
    const results = await Promise.allSettled(tasks);
    const bad = results.find((r) => r.status === "rejected");
    if (bad && bad.status === "rejected") {
      setErr(bad.reason instanceof Error ? bad.reason.message : "Load failed");
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      title="Impact & analytics"
      eyebrow={isAdmin ? "Admin · Module 24" : "Module 24"}
      subtitle="Sustainability, demand forecasting and model evaluation."
    >
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 grid gap-4"
      >
        {mine && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 }}
              className="glass-card p-6"
            >
              <ImpactPanel title="Rides you joined" imp={mine.as_rider} />
            </motion.div>
            {mine.trips_as_driver > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="glass-card p-6"
              >
                <ImpactPanel title="Rides you offered" imp={mine.as_driver} />
                <p className="mt-3 text-[11px] text-muted">
                  You paid ₹{mine.paid_total} and collected ₹{mine.collected_total} across your
                  rides (net ₹{mine.net}). {mine.note}
                </p>
              </motion.div>
            )}
          </>
        )}
        {isAdmin && impact && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="glass-card p-6"
          >
            <ImpactPanel title="Platform impact" imp={impact} />
          </motion.div>
        )}
        {isAdmin && demand && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="glass-card p-6"
          >
            <DemandPanel d={demand} />
          </motion.div>
        )}
        {isAdmin && evaluation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="glass-card p-6"
          >
            <EvalPanel e={evaluation} />
          </motion.div>
        )}
        {isAdmin && (!impact || !demand || !evaluation) && (
          <p className="text-xs text-muted">Loading the admin panels…</p>
        )}
      </motion.div>
    </PageShell>
  );
}