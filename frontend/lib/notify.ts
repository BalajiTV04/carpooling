// Notification client (Module 23): the in-app feed behind the nav bell.
// In-app only — the project ships no email/SMS provider, and Module 20's hub
// is trip-scoped, so this is served by polling (summary every 30s, full feed
// on demand). `action` deep-links: "rate" -> Module 22, "live" -> Module 17.
export type Priority = "low" | "normal" | "high" | "critical";

export type Notification = {
  id: string; type: string; title: string; body: string;
  priority: Priority; action: "rate" | "live" | null;
  trip_id: string | null; booking_id: string | null;
  read_at: string | null; created_at: string | null;
};

export type NotificationFeed = {
  count: number; unread: number; critical: number;
  by_type: Record<string, number>; items: Notification[];
};

export type NotificationSummary = {
  unread: number; critical: number; by_type: Record<string, number>;
};

function base() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
}

async function req(path: string, opts: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("voltride_token") : null;
  const res = await fetch(`${base()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ?? `Request failed (${res.status})`);
  return body;
}

export const notifyApi = {
  feed: (limit = 20): Promise<NotificationFeed> => req(`/notifications?limit=${limit}`),
  summary: (): Promise<NotificationSummary> => req("/notifications/summary"),
  markRead: (id: string): Promise<Notification> =>
    req(`/notifications/${id}/read`, { method: "POST" }),
  markAllRead: (): Promise<{ marked: number }> =>
    req("/notifications/read-all", { method: "POST" })
};

export function priorityDotCls(p: Priority): string {
  return p === "critical" ? "bg-rose-400"
    : p === "high" ? "bg-amber-400"
      : p === "low" ? "bg-[#5b6194]" : "bg-volt-400";
}

/** Where a notification's `action` hint takes the user.
 *  Only `rate` has a real destination today: /requests lists the rider's own
 *  completed rides with the Module 22 prompt. `live` has no per-trip route
 *  yet (the live view lives inside a search card), so it returns null and the
 *  bell shows a label instead of a link that would go nowhere. */
export function actionHref(n: Notification): string | null {
  if (n.action === "rate") return "/requests";
  return null;
}

export function actionLabel(n: Notification): string | null {
  if (n.action === "rate") return "Rate this ride";
  if (n.action === "live") return "Live view in your booking card";
  return null;
}