"use client";
// /me (Module 4): identity card + edit + role upgrade + password + preview.
import { useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { profileApi, type FullProfile } from "@/lib/profile";
import { Field, inputCls } from "@/components/AuthShell";
import { Stars } from "@/components/Stars";
import { ratingApi, type RatingCard } from "@/lib/ratings";

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
    <section className="mt-4 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
      <h2 className="font-display font-bold">Reviews received</h2>
      {card.rating_count === 0 ? (
        <p className="mt-2 text-xs text-[#A5ABD6]">
          No reviews yet. They appear after a completed ride — Module 22 only
          lets the other party of a real booking rate you.
        </p>
      ) : (
        <>
          <div className="mt-2"><Stars avg={card.rating_avg} count={card.rating_count} /></div>
          <div className="mt-2 grid gap-0.5">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} className="flex items-center gap-2 text-[11px] text-[#A5ABD6]">
                <span className="w-3">{n}★</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-night-950">
                  <span
                    className="block h-full bg-volt-400"
                    style={{ width: `${((Number(card.distribution[String(n)] ?? 0)) / max) * 100}%` }}
                  />
                </span>
                <span className="w-4 text-right font-mono">{card.distribution[String(n)] ?? 0}</span>
              </div>
            ))}
          </div>
          <ul className="mt-3 grid gap-2">
            {card.items.map((r) => (
              <li key={r.id} className="rounded-2xl bg-night-950 p-3 text-[11px]">
                <p className="text-volt-300">
                  {"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}
                  <span className="ml-1 text-[#A5ABD6]">
                    {r.rater_name ?? "a rider"}
                    {r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString("en-IN")}` : ""}
                  </span>
                </p>
                {r.comment && <p className="mt-0.5 text-[#EEF0FF]">{r.comment}</p>}
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
        setForm({ full_name: full.full_name ?? "", email: full.email ?? "" });
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Load failed"));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const updated = await profileApi.update({
        full_name: form.full_name || undefined,
        email: form.email === "" ? null : form.email
        // avatar_url is intentionally NOT sent: the field was removed from this
        // form (it was never rendered anywhere), so the stored value is simply
        // left alone rather than silently cleared.
      });
      setP(updated);
      await refresh().catch(() => undefined);
      setMsg("Profile saved ✓");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const upgrade = async () => {
    setErr(null);
    setMsg(null);
    try {
      setP(await profileApi.addRole("driver"));
      await refresh().catch(() => undefined);
      setMsg("Role added: driver ✓");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Role add failed");
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await profileApi.changePassword(pw);
      setPw({ current_password: "", new_password: "" });
      setMsg("Password changed ✓");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Password change failed");
    }
  };
  const initial = (p?.full_name || "?").trim().charAt(0).toUpperCase();
  return (
    <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
      <a href="/" className="text-sm text-volt-300">← VoltRide</a>
      <section className="mt-3 flex items-center gap-4 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5 shadow-card">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-iris-500 font-display text-2xl font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-xl font-bold">{p?.full_name ?? "…"}</p>
          <p className="text-sm text-[#A5ABD6]">{p?.phone ?? ""}</p>
          <div className="mt-1"><Stars avg={p?.rating_avg ?? null} count={p?.rating_count ?? 0} /></div>
        </div>
        {(p?.phone_verified ?? false) ? (
          <span className="rounded-full bg-volt-400 px-2.5 py-0.5 text-xs font-bold text-night-950">✓</span>
        ) : (
          <a href="/verify" className="rounded-full border border-volt-400/60 px-2.5 py-0.5 text-xs font-bold text-volt-300">verify →</a>
        )}
      </section>
      {msg && <p className="mt-3 rounded-2xl border border-volt-400/40 bg-volt-400/10 p-3 text-sm text-volt-300">{msg}</p>}
      {err && <p className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}

      <section className="mt-4 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
        <h2 className="font-display font-bold">Edit profile</h2>
        <form onSubmit={save} className="mt-3 grid gap-3">
          <Field label="Full name">
            <input className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} minLength={2} />
          </Field>
          <Field label="Email (optional — blank clears)">
            <input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
          </Field>
          <button disabled={busy} className="rounded-2xl bg-volt-400 py-2.5 text-sm font-bold text-night-950 disabled:opacity-60">
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>

      <section className="mt-4 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
        <h2 className="font-display font-bold">Roles</h2>
        {(p?.roles ?? []).includes("driver") ? (
          <p className="mt-2 text-xs text-[#A5ABD6]">Driver ✓ · vehicle (Module 5) · publish (Module 6).</p>
        ) : (
          <button onClick={upgrade} className="mt-2 rounded-full bg-volt-400 px-4 py-1.5 text-xs font-bold text-night-950">
            Become a driver →
          </button>
        )}
      </section>

      {p && <ReviewsCard userId={p.id} />}

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <form onSubmit={changePw} className="rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
          <h2 className="font-display font-bold">Password</h2>
          <div className="mt-3 grid gap-3">
            <Field label="Current">
              <input className={inputCls} type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
            </Field>
            <Field label="New (min 6)">
              <input className={inputCls} type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} minLength={6} required />
            </Field>
            <button className="rounded-2xl border border-[rgba(154,151,255,.35)] py-2 text-sm text-[#EEF0FF]">Change</button>
          </div>
        </form>
        <div className="rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5">
          <h2 className="font-display font-bold">Public preview</h2>
          <p className="text-xs text-[#A5ABD6]">No phone / email / hash — ever.</p>
          <div className="mt-3 rounded-2xl bg-night-950 p-4">
            <p className="font-semibold">{p?.full_name ?? "…"}</p>
            <Stars avg={p?.rating_avg ?? null} count={p?.rating_count ?? 0} />
          </div>
          <button
            onClick={() => { logout(); window.location.href = "/"; }}
            className="mt-4 w-full rounded-2xl border border-rose-400/50 py-2 text-sm text-rose-300"
          >
            Log out
          </button>
        </div>
      </section>
    </main>
  );
}
