// Profile client: full profile, patch, role add, password change, public card.
export type FullProfile = {
  id: string; phone: string; email: string | null; full_name: string;
  roles: string[]; avatar_url: string | null; phone_verified: boolean;
  rating_avg: number | null; rating_count: number; status: string;
};
export type PublicProfile = {
  id: string; full_name: string; roles: string[];
  avatar_url: string | null; phone_verified: boolean;
  rating_avg: number | null; rating_count: number;
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

export const profileApi = {
  mine: (): Promise<FullProfile> => req("/users/me"),
  update: (b: { full_name?: string; email?: string | null; avatar_url?: string | null }): Promise<FullProfile> =>
    req("/users/me", { method: "PATCH", body: JSON.stringify(b) }),
  addRole: (role: "driver" | "passenger"): Promise<FullProfile> =>
    req("/users/me/roles", { method: "POST", body: JSON.stringify({ role }) }),
  changePassword: (b: { current_password: string; new_password: string }) =>
    req("/users/me/password", { method: "POST", body: JSON.stringify(b) }),
  public: (id: string): Promise<PublicProfile> => req(`/users/${id}`)
};
