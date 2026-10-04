// Auth client: register/login/OTP/me + localStorage session.
// Token lives in localStorage ("voltride_token") — simple + demo-friendly.
// (HttpOnly cookies are safer; flagged in Module 3 docs as hardening step.)
export type Role = "driver" | "passenger" | "admin";
export type SessionUser = {
  id: string; phone: string; full_name: string;
  roles: Role[]; phone_verified: boolean;
};

const KEY = "voltride_token";
const USER_KEY = "voltride_user";

function base() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
}

async function req(path: string, opts: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
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

export function saveSession(token: string, user: SessionUser) {
  localStorage.setItem(KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(USER_KEY);
}
export function loadSession(): { token: string | null; user: SessionUser | null } {
  if (typeof window === "undefined") return { token: null, user: null };
  try {
    return {
      token: localStorage.getItem(KEY),
      user: JSON.parse(localStorage.getItem(USER_KEY) ?? "null")
    };
  } catch {
    return { token: null, user: null };
  }
}

export const authApi = {
  register: (b: { phone: string; password: string; full_name: string; roles: Role[] }) =>
    req("/auth/register", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { phone: string; password: string }) =>
    req("/auth/login", { method: "POST", body: JSON.stringify(b) }),
  otpRequest: (phone: string) =>
    req("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }),
  otpVerify: (phone: string, code: string) =>
    req("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) }),
  me: () => req("/auth/me"),
  logout: () => req("/auth/logout", { method: "POST" })
};
