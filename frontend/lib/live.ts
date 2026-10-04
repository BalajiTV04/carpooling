"use client";
// Live push client (Module 20): one WebSocket per trip, auto-reconnect.
//
// The token rides in the query string because a browser cannot set an
// Authorization header on a WebSocket handshake (documented in
// backend/app/api/v1/live.py). Server frames are typed: hello | state | fix |
// alert | ack | pong | error.
//
// `onStatus` lets the UI show whether it is receiving PUSH or has fallen back
// to polling — the honest thing to display during a demo.
export type StreamStatus = "connecting" | "live" | "closed";

export type StreamHandlers = {
  onFrame?: (frame: Record<string, unknown>) => void;
  onHello?: (frame: Record<string, unknown>) => void;
  onState?: (frame: Record<string, unknown>) => void;
  onFix?: (frame: Record<string, unknown>) => void;
  onAlert?: (frame: Record<string, unknown>) => void;
  onAck?: (frame: Record<string, unknown>) => void;
  onStatus?: (status: StreamStatus, detail?: string) => void;
};

export type Stream = {
  send: (msg: Record<string, unknown>) => boolean;
  close: () => void;
};

export function token(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("voltride_token") : null;
}

export function tripSocketUrl(tripId: string, jwt: string | null): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  const ws = base.replace(/^http/, "ws");
  return `${ws}/stream/trips/${tripId}?token=${encodeURIComponent(jwt ?? "")}`;
}

const MAX_BACKOFF_MS = 15000;

export function subscribeTrip(tripId: string, h: StreamHandlers): Stream {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    const url = tripSocketUrl(tripId, token());
    h.onStatus?.("connecting");
    try {
      ws = new WebSocket(url);
    } catch (e) {
      h.onStatus?.("closed", e instanceof Error ? e.message : "socket unavailable");
      return;
    }
    ws.onopen = () => {
      attempt = 0;
      h.onStatus?.("live");
    };
    ws.onmessage = (ev) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      h.onFrame?.(frame);
      switch (frame.type) {
        case "hello": h.onHello?.(frame); break;
        case "state": h.onState?.(frame); break;
        case "fix": h.onFix?.(frame); break;
        case "alert": h.onAlert?.(frame); break;
        case "ack": h.onAck?.(frame); break;
        default: break;
      }
    };
    ws.onclose = (ev) => {
      ws = null;
      if (closed) return;
      // 4401/4403 are permanent (bad or missing session / not a trip party):
      // reconnecting would spin, so report and stop.
      if (ev.code === 4401 || ev.code === 4403) {
        h.onStatus?.("closed", ev.code === 4401 ? "session rejected" : "not part of this trip");
        return;
      }
      h.onStatus?.("closed", "reconnecting…");
      attempt += 1;
      const wait = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, attempt));
      timer = setTimeout(open, wait);
    };
    ws.onerror = () => { /* onclose always follows; keep the UI quiet */ };
  };

  open();

  return {
    send: (msg) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(); } catch { /* already gone */ }
      ws = null;
    },
  };
}
