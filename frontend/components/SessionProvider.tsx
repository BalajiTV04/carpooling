"use client";
// Session context: single source of truth for login state across pages.
// Wraps the app in layout (Module 4+ will add profile editing on top).
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi, clearSession, loadSession, saveSession, type SessionUser } from "@/lib/auth";

type Ctx = {
  token: string | null;
  user: SessionUser | null;
  ready: boolean;
  error: string | null;
  login: (phone: string, password: string) => Promise<void>;
  register: (b: { phone: string; password: string; full_name: string; roles: ("driver" | "passenger")[] }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  setVerified: () => void;
};

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    setToken(s.token);
    setUser(s.user);
    setReady(true);
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    setError(null);
    try {
      const r = await authApi.login({ phone, password });
      saveSession(r.access_token, r.user);
      setToken(r.access_token);
      setUser(r.user);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed");
      throw e;
    }
  }, []);

  const register = useCallback(async (b: { phone: string; password: string; full_name: string; roles: ("driver" | "passenger")[] }) => {
    setError(null);
    try {
      const r = await authApi.register(b);
      saveSession(r.access_token, r.user);
      setToken(r.access_token);
      setUser(r.user);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Register failed");
      throw e;
    }
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!loadSession().token) return;
    const u = await authApi.me();
    const s = loadSession();
    if (s.token) saveSession(s.token, u);
    setUser(u);
  }, []);

  const setVerified = useCallback(() => {
    setUser((u) => {
      if (!u) return u;
      const nu = { ...u, phone_verified: true };
      const s = loadSession();
      if (s.token) saveSession(s.token, nu);
      return nu;
    });
  }, []);

  return (
    <SessionCtx.Provider value={{ token, user, ready, error, login, register, logout, refresh, setVerified }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}
