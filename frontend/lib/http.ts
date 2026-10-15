// Shared API request helper — ONE place for the base URL, the auth header and
// human-readable error messages.
//
// Before this existed, every lib/*.ts copy-pasted the same fetch wrapper with
// `throw new Error(body?.detail)`. FastAPI returns `detail` as a plain string
// for normal errors but as an ARRAY of {loc, msg, value} objects for a 422
// validation failure — which rendered on the page as "[object Object]" and hid
// the real reason (e.g. "depart_at must be in the future"). messageOf()
// flattens both shapes so every page shows what the backend actually said.

const TOKEN_KEY = "voltride_token";

export function base(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
}

export function messageOf(body: unknown, status: number): string {
  const d = (body as { detail?: unknown })?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const parts = d
      .map((e) => {
        const loc = Array.isArray((e as { loc?: unknown })?.loc)
          ? (e as { loc: unknown[] }).loc.slice(1).join(" ")
          : "";
        const msg = (e as { msg?: string })?.msg ?? "invalid value";
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }
  return `Request failed (${status})`;
}

// Default `any` on purpose: every call site previously got an implicit `any`
// from `res.json()` and accessed fields directly (r.dev_code, t.status, …).
// Keeping that contract means this refactor changes error MESSAGES only, not
// the typing of the hundreds of existing call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  const res = await fetch(`${base()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageOf(body, res.status));
  return body as T;
}
