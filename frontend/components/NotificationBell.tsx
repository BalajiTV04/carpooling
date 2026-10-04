"use client";
// NotificationBell (Module 23): unread count in the nav, feed on click.
//
// Polling, not sockets: Module 20's hub is deliberately trip-scoped, and a
// user-level fan-out would need a shared bus. The summary poll is cheap (a
// count) and only runs while a session exists.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  actionHref, actionLabel, notifyApi, priorityDotCls,
  type Notification, type NotificationSummary
} from "@/lib/notify";

const POLL_MS = 30000;

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell({ enabled }: { enabled: boolean }) {
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const poll = useCallback(() => {
    if (!enabled) return;
    notifyApi.summary().then(setSummary).catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    poll();
    if (!enabled) return;
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll, enabled]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openFeed = async () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      try {
        const feed = await notifyApi.feed(15);
        setItems(feed.items);
        setLoaded(true);
      } catch {
        setLoaded(true);
      }
    }
    if (next) poll();
  };

  const markAll = async () => {
    try {
      await notifyApi.markAllRead();
      setSummary({ unread: 0, critical: 0, by_type: {} });
      const now = new Date().toISOString();
      setItems((rows) => rows.map((r) => ({ ...r, read_at: r.read_at ?? now })));
    } catch { /* the count re-syncs on the next poll */ }
  };

  const markOne = async (n: Notification) => {
    if (n.read_at) return;
    try {
      await notifyApi.markRead(n.id);
      setItems((rows) => rows.map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)));
      poll();
    } catch { /* same */ }
  };

  if (!enabled) return null;
  const unread = summary?.unread ?? 0;
  const critical = summary?.critical ?? 0;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={openFeed}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative rounded-full border border-[rgba(154,151,255,.35)] px-3 py-1.5 text-[#A5ABD6] hover:text-volt-300"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className={`absolute -right-1 -top-1 min-w-[18px] rounded-full px-1 text-[10px] font-bold leading-[18px] text-night-950 ${
            critical > 0 ? "bg-rose-400" : "bg-volt-400"
          }`}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-[rgba(154,151,255,.3)] bg-night-950 p-2 shadow-card">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="font-display text-sm font-bold">Notifications</p>
            {unread > 0 && (
              <button onClick={markAll} className="text-[11px] text-volt-300 underline">
                mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!loaded && <p className="px-2 py-3 text-[11px] text-[#5b6194]">Loading…</p>}
            {loaded && items.length === 0 && (
              <p className="px-2 py-3 text-[11px] text-[#5b6194]">
                Nothing yet. Booking activity and safety alerts land here.
              </p>
            )}
            {items.map((n) => {
              const href = actionHref(n);
              const label = actionLabel(n);
              return (
                <div
                  key={n.id}
                  className={`rounded-xl px-2 py-2 text-[11px] ${
                    n.read_at ? "opacity-60" : "bg-night-900/70"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${priorityDotCls(n.priority)}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-[#EEF0FF]">{n.title}</p>
                      <p className="text-[#A5ABD6]">{n.body}</p>
                      <p className="mt-0.5 text-[10px] text-[#5b6194]">
                        {ago(n.created_at)}
                        {label && <> · <span className="text-volt-300">{label}</span></>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 flex gap-2 pl-4">
                    {!n.read_at && (
                      <button onClick={() => markOne(n)} className="text-[10px] text-volt-300 underline">
                        mark read
                      </button>
                    )}
                    {href && (
                      <button
                        onClick={() => { setOpen(false); window.location.assign(href); }}
                        className="text-[10px] text-volt-300 underline"
                      >
                        open
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="px-2 py-1 text-[10px] text-[#5b6194]">
            In-app only — no email or SMS is configured.
          </p>
        </div>
      )}
    </div>
  );
}
