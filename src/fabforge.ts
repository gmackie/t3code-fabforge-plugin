type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type FabForgeSnapshot = { projects: readonly { id: string; name: string }[]; kitRuns: readonly { id: string; status: string }[] };
export type CockpitViewModel = { navigation: readonly string[]; metrics: { projects: number; activeKitRuns: number; blockedKitRuns: number } };
export type SurfaceCard =
  | { kind: "metric"; id: string; title: string; value: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }
  | { kind: "list"; id: string; title: string; items: readonly { id: string; title: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }[] };
export type SurfaceModel = { pluginId: string; navigationId: string; title: string; refreshedAt: string; cards: readonly SurfaceCard[] };

async function get(input: { endpoint: string; token: string; workspaceId: string; fetchImpl: FetchLike }, path: string): Promise<any> {
  const url = new URL(`${input.endpoint.replace(/\/$/, "")}${path}`); url.searchParams.set("workspaceId", input.workspaceId);
  const response = await input.fetchImpl(url, { headers: { authorization: `Bearer ${input.token}` } });
  if (!response.ok) throw new Error(`FabForge GET ${path} failed: ${response.status}`);
  return response.json();
}
function payload(value: any): any { return value?.data ?? value; }
export function normalizeFabForgeSnapshot(value: any): FabForgeSnapshot { return { projects: Array.isArray(value?.projects) ? value.projects.map((p: any) => ({ id: String(p.id), name: String(p.name ?? p.slug ?? p.id) })) : [], kitRuns: Array.isArray(value?.runs) ? value.runs.map((r: any) => ({ id: String(r.id), status: String(r.status ?? "unknown") })) : [] }; }
export function buildCockpitViewModel(snapshot: FabForgeSnapshot): CockpitViewModel { return { navigation: ["projects", "components", "work-orders", "kit-runs", "evidence"], metrics: { projects: snapshot.projects.length, activeKitRuns: snapshot.kitRuns.filter((run) => !["complete", "cancelled"].includes(run.status)).length, blockedKitRuns: snapshot.kitRuns.filter((run) => run.status === "blocked").length } }; }
export function buildSurfaceModel(snapshot: FabForgeSnapshot, navigationId = "fabforge.projects"): SurfaceModel {
  const activeKitRuns = snapshot.kitRuns.filter((run) => !["complete", "cancelled"].includes(run.status)).length;
  const blockedKitRuns = snapshot.kitRuns.filter((run) => run.status === "blocked").length;
  return {
    pluginId: "com.t3code.fabforge",
    navigationId,
    title: "Fabrication cockpit",
    refreshedAt: new Date().toISOString(),
    cards: [
      { kind: "metric", id: "projects", title: "Projects", value: `${snapshot.projects.length}` },
      { kind: "metric", id: "active-kit-runs", title: "Active kit runs", value: `${activeKitRuns}` },
      { kind: "metric", id: "blocked-kit-runs", title: "Blocked kit runs", value: `${blockedKitRuns}`, status: blockedKitRuns === 0 ? "positive" : "negative" },
      { kind: "list", id: "kit-runs", title: "Kit runs", items: snapshot.kitRuns.slice(0, 8).map((run) => ({ id: run.id, title: run.id, detail: run.status, status: run.status === "complete" ? "positive" as const : run.status === "blocked" ? "negative" as const : "warning" as const })) },
    ],
  };
}
export function createFabForgeClient(input: { endpoint: string; token: string; workspaceId: string; fetchImpl?: FetchLike }) {
  const transport = { ...input, fetchImpl: input.fetchImpl ?? fetch };
  return { async snapshot() { const projects = payload(await get(transport, "/api/fabrication/v0/projects")); const runs = payload(await get(transport, "/api/fabrication/v0/kit-runs")); return normalizeFabForgeSnapshot({ projects, runs }); } };
}
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
