"use client";
// /me (Module 4): identity card + edit + role upgrade + password + preview.
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useSession } from "@/components/SessionProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { profileApi, type FullProfile } from "@/lib/profile";
import { Field, inputCls } from "@/components/AuthShell";
import { Stars } from "@/components/Stars";
import { ratingApi, type RatingCard } from "@/lib/ratings";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Separator } from "@/components/ui/Separator";
import { PageShell } from "@/components/PageShell";

/** Module 22: reviews this user has RECEIVED (aggregate + histogram + feed). */
function ReviewsCard({ userId }: { userId: string }) {
  const [card, setCard] = useState<RatingCard | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    ratingApi.forUser(userId)
      .then(setCard)
      .catch(() => setFailed(true));
  }, [userId]);
  if (failed) return null;
  if (!card) return null;
  const max = Math.max(1, ...Object.values(card.distribution).map(Number));
  return (
    <section className="glass-card p-6 mt-6">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-display font-bold text-ink">Reviews received</h2>
        <Badge variant="muted">{card.rating_count} reviews</Badge>
      </div>
      {card.rating_count === 0 ? (
        <div className="empty-state py-8">
          <div className="empty-icon">
            <Stars avg={null} count={0} />
          </div>
          <p className="text-sm text-muted">
            No reviews yet. They appear after a completed ride.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2"><Stars avg={card.rating_avg} count={card.rating_count} /></div>
          <div className="mt-4 grid gap-1">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} className="flex items-center gap-2 text-[11px] text-muted">
                <span className="w-3">{n}★</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                  <span
                    className="block h-full bg-brand-teal"
                    style={{ width: `${((Number(card.distribution[String(n)] ?? 0)) / max) * 100}%` }}
                  />
                </span>
                <span className="w-4 text-right font-mono">{card.distribution[String(n)] ?? 0}</span>
              </div>
            ))}
          </div>
          <ul className="mt-4 grid gap-2">
            {card.items.map((r) => (
              <li key={r.id} className="panel-inset p-3 text-[11px]">
                <p className="text-brand-teal">
                  {"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}
                  <span className="ml-1 text-muted">
                    {r.rater_name ?? "a rider"}
                    {r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString("en-IN")}` : ""}
                  </span>
                </p>
                {r.comment && <p className="mt-0.5 text-ink">{r.comment}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function MePage() {
  return (
    <RequireAuth>
      <MeInner />
    </RequireAuth>
  );
}

function MeInner() {
  const { user, logout, refresh } = useSession();
  const [p, setP] = useState<FullProfile | null>(null);
  const [form, setForm] = useState({ full_name: "", email: "" });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    profileApi.mine()
      .then((full) => {
        setP(full);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Load failed"));
  }, [refresh]);

  const initial = (p?.full_name ?? "U").charAt(0).toUpperCase();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await profileApi.update({ full_name: form.full_name, email: form.email || undefined });
      setMsg("Profile saved.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const upgrade = async () => {
    try {
      await profileApi.addRole("driver");
      setMsg("Driver role added — go to the garage to add a vehicle.");
      loadProfile();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upgrade failed");
    }
  };

  const loadProfile = () => {
    profileApi.mine().then(setP).catch(() => {});
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await profileApi.changePassword(pw);
      setMsg("Password changed.");
      setPw({ current_password: "", new_password: "" });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Password change failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageShell
      title="My profile"
      eyebrow="Account"
      subtitle="Manage your identity, roles, and ride reputation."
      wide
    >
      {msg && <Alert variant="success" className="mt-6">{msg}</Alert>}
      {err && <Alert variant="danger" className="mt-6">{err}</Alert>}

      {/* Identity card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-6 glass-card p-6"
      >
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="flex-shrink-0">
            <Avatar src={p?.avatar_url ?? undefined} fallback={initial} size="xl" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-xl font-bold text-ink">
              {p?.full_name ?? "…"}
            </p>
            <p className="text-sm text-muted">{p?.phone ?? ""}</p>
            <div className="mt-2 flex items-center gap-2">
              <Stars avg={p?.rating_avg ?? null} count={p?.rating_count ?? 0} />
              {(p?.phone_verified ?? false) ? (
                <Badge variant="success" className="ml-2 text-[10px]">✓ Verified</Badge>
              ) : (
                <Link
                  href="/verify"
                  className="ml-2 btn btn-ghost btn-sm text-brand-teal hover:bg-brand-teal/5"
                >
                  Verify →
                </Link>
              )}
            </div>
          </div>
          <div className="md:ml-auto">
            <Button variant="ghost" size="sm" onClick={() => { logout(); window.location.href = "/"; }}>
              Sign out
            </Button>
          </div>
        </div>
      </motion.div>

      <Separator className="my-8" />

      {/* Edit profile */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="glass-card p-6"
      >
        <h2 className="font-display font-bold text-ink mb-1">Edit profile</h2>
        <p className="text-sm text-muted mb-4">Update your public display name and email.</p>
        <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
          <Field label="Full name">
            <input className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} minLength={2} />
          </Field>
          <Field label="Email (optional — blank clears)">
            <input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
          </Field>
          <Button variant="primary" size="md" disabled={busy} className="md:col-span-2 w-auto">
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </motion.div>

      <Separator className="my-8" />

      {/* Roles */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="glass-card p-6"
      >
        <h2 className="font-display font-bold text-ink mb-1">Roles</h2>
        {(p?.roles ?? []).includes("driver") ? (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="success">Driver ✓</Badge>
            <span className="text-xs text-muted">Vehicle · publish trips · earn</span>
          </div>
        ) : (
          <Button variant="primary" size="md" onClick={upgrade} className="w-auto">
            Become a driver →
          </Button>
        )}
      </motion.div>

      {p && <ReviewsCard userId={p.id} />}

      <Separator className="my-8" />

      {/* Password + public preview */}
      <div className="grid gap-4 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="glass-card p-6"
        >
          <h2 className="font-display font-bold text-ink mb-1">Password</h2>
          <div className="mt-3 grid gap-3">
            <Field label="Current">
              <input className={inputCls} type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
            </Field>
            <Field label="New (min 6)">
              <input className={inputCls} type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} minLength={6} required />
            </Field>
            <Button variant="ghost" size="md" disabled={busy} className="w-auto">
              {busy ? "Saving…" : "Change"}
            </Button>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="glass-card p-6"
        >
          <h2 className="font-display font-bold text-ink mb-1">Public preview</h2>
          <p className="text-xs text-muted mb-3">No phone / email / hash — ever.</p>
          <div className="panel-inset p-4">
            <p className="font-semibold text-ink">{p?.full_name ?? "…"}</p>
            <Stars avg={p?.rating_avg ?? null} count={p?.rating_count ?? 0} />
          </div>
        </motion.div>
      </div>
    </PageShell>
  );
}
