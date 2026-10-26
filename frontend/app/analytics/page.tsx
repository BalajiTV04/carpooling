"use client";
// /analytics (Module 24): sustainability, demand forecast, model evaluation.
//
// Everyone sees their own impact; admins additionally see the platform-wide
// impact, the demand forecast and the rule-vs-AI evaluation. Each panel states
// its own assumptions, because these are estimates under stated assumptions
// rather than measured facts.
import { useCallback, useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { PageShell } from "@/components/PageShell";
import { useSession } from "@/components/SessionProvider";
import {
  analyticsApi, type Demand, type Evaluation, type Impact, type MyImpact
} from "@/lib/analytics";

const card = "panel p-5";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel-inset p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-2xl font-bold text-brand-teal">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function ImpactPanel({ title, imp }: { title: string; imp: Impact }) {
  return (
    <section className={card}>
      <h2 className="font-display font-bold">{title}</h2>
      {imp.trips === 0 ? (
        <p className="mt-2 text-sm text-muted">No completed rides to measure yet.</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
            <table className="mt-4 w-full text-[11px]">
              <thead className="text-muted">
                <tr className="text-left">
                  <th className="py-1">fuel</th><th className="py-1">trips</th>
                  <th className="py-1">km</th><th className="py-1">CO2 kg</th>
                  <th className="py-1">cars</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {Object.entries(imp.by_fuel).map(([f, v]) => (
                  <tr key={f} className="border-t border-iris-400/12">
                    <td className="py-1 text-ink">{f}</td>
                    <td className="py-1">{v.trips}</td>
                    <td className="py-1">{v.km_avoided}</td>
                    <td className="py-1">{v.co2_avoided_kg}</td>
                    <td className="py-1">{v.vehicles_avoided}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-[10px] text-muted">
            {imp.emission_basis} · {imp.note}
          </p>
        </>
      )}
    </section>
  );
}

function DemandPanel({ d }: { d: Demand }) {
  const rows = (list: Demand["busiest"]) => list.map((b) => (
    <tr key={b.bucket} className="border-t border-iris-400/12 text-muted">
      <td className="py-1 text-ink">{b.weekday} {String(b.hour).padStart(2, "0")}:00</td>
      <td className="py-1">{b.observed}</td>
      <td className="py-1">{b.horizon_total}</td>
    </tr>
  ));
  return (
    <section className={card}>
      <h2 className="font-display font-bold">Demand forecast</h2>
      <p className="mt-1 text-[11px] text-muted">
        {d.samples} departures over {d.history.window_days} days · horizon {d.horizon_days} days
        {d.backtest.mae !== null && (
          <> · backtest MAE <b className="text-brand-teal">{d.backtest.mae}</b>, RMSE{" "}
            <b className="text-brand-teal">{d.backtest.rmse}</b></>
        )}
      </p>
      <p className="text-[10px] text-muted">{d.method}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold text-ink">Busiest slots</p>
          <table className="mt-1 w-full text-[11px]">
            <thead className="text-muted"><tr className="text-left"><th className="py-1">slot</th><th className="py-1">seen</th><th className="py-1">forecast</th></tr></thead>
            <tbody>{rows(d.busiest)}</tbody>
          </table>
        </div>
        <div>
          <p className="text-xs font-bold text-ink">Thinnest slots</p>
          <table className="mt-1 w-full text-[11px]">
            <thead className="text-muted"><tr className="text-left"><th className="py-1">slot</th><th className="py-1">seen</th><th className="py-1">forecast</th></tr></thead>
            <tbody>{rows(d.quietest)}</tbody>
          </table>
        </div>
      </div>
      {d.backtest.note && <p className="mt-2 text-[10px] text-muted">{d.backtest.note}</p>}
    </section>
  );
}

function ScoreRow({ name, m }: { name: string; m: Evaluation["rule_score"] }) {
  return (
    <tr className="border-t border-iris-400/12 text-muted">
      <td className="py-1 text-ink">{name}</td>
      <td className="py-1">{m.n}</td>
      <td className="py-1">{m.auc ?? "—"}</td>
      <td className="py-1">{m.precision ?? "—"}</td>
      <td className="py-1">{m.recall ?? "—"}</td>
      <td className="py-1">{m.f1 ?? "—"}</td>
    </tr>
  );
}

function EvalPanel({ e }: { e: Evaluation }) {
  return (
    <section className={card}>
      <h2 className="font-display font-bold">Did ranking predict rides?</h2>
      <p className="mt-1 text-[11px] text-muted">
        {e.label_definition} · {e.labelled} labelled bookings
        {e.comparison && <> · <b className="text-brand-teal">{e.comparison.winner}</b> by AUC ({e.comparison.delta_auc > 0 ? "+" : ""}{e.comparison.delta_auc})</>}
      </p>
      {e.labelled === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No scored bookings have reached an outcome yet — finish or cancel a few rides first.
        </p>
      ) : (
        <table className="mt-3 w-full text-[11px]">
          <thead className="text-muted">
            <tr className="text-left">
              <th className="py-1">score</th><th className="py-1">n</th><th className="py-1">AUC</th>
              <th className="py-1">prec</th><th className="py-1">recall</th><th className="py-1">F1</th>
            </tr>
          </thead>
          <tbody>
            <ScoreRow name="Module 9 rule" m={e.rule_score} />
            <ScoreRow name="Module 16 AI" m={e.ai_score} />
          </tbody>
        </table>
      )}
      {e.offline_ranker_auc && (
        <p className="mt-3 text-[11px] text-muted">
          Offline AUC on the labelled training set ({e.deployed_model} deployed):
          {" "}
          {Object.entries(e.offline_ranker_auc).map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
      )}
      <p className="mt-2 text-[10px] text-muted">{e.caveat}</p>
    </section>
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
    // /me always works; the platform panels are admin-only, so a failure there
    // must not blank the personal panel.
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
      {err && <p className="alert alert-err mt-5">{err}</p>}
      <div className="mt-4 grid gap-4">
        {mine && (
          <>
            <ImpactPanel title="Rides you joined" imp={mine.as_rider} />
            {mine.trips_as_driver > 0 && (
              <>
                <ImpactPanel title="Rides you offered" imp={mine.as_driver} />
                <p className="text-[11px] text-muted">
                  You paid ₹{mine.paid_total} and collected ₹{mine.collected_total} across your
                  rides (net ₹{mine.net}). {mine.note}
                </p>
              </>
            )}
          </>
        )}
        {isAdmin && impact && <ImpactPanel title="Platform impact" imp={impact} />}
        {isAdmin && demand && <DemandPanel d={demand} />}
        {isAdmin && evaluation && <EvalPanel e={evaluation} />}
        {isAdmin && (!impact || !demand || !evaluation) && (
          <p className="text-xs text-muted">Loading the admin panels…</p>
        )}
      </div>
    </PageShell>
  );
}

export default function AnalyticsPage() {
  return (
    <RequireAuth>
      <AnalyticsInner />
    </RequireAuth>
  );
}

