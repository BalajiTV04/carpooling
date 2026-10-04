// Tiny typed client for backend health (Module 1). Auth/trips/search
// clients will live beside this file in their own modules.
export type HealthResp = {
  status: string;
  service: string;
  db: "connected" | "disconnected";
  routing_provider: string;
};

export async function fetchHealth(): Promise<HealthResp> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  const res = await fetch(`${base}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}
