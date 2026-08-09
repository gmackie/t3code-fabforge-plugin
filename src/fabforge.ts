type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type FabForgeSnapshot = { projects: readonly { id: string; name: string }[]; kitRuns: readonly { id: string; status: string }[] };
export type CockpitViewModel = { navigation: readonly string[]; metrics: { projects: number; activeKitRuns: number; blockedKitRuns: number } };

async function get(input: { endpoint: string; token: string; workspaceId: string; fetchImpl: FetchLike }, path: string): Promise<any> {
  const url = new URL(`${input.endpoint.replace(/\/$/, "")}${path}`); url.searchParams.set("workspaceId", input.workspaceId);
  const response = await input.fetchImpl(url, { headers: { authorization: `Bearer ${input.token}` } });
  if (!response.ok) throw new Error(`FabForge GET ${path} failed: ${response.status}`);
  return response.json();
}
function payload(value: any): any { return value?.data ?? value; }
export function normalizeFabForgeSnapshot(value: any): FabForgeSnapshot { return { projects: Array.isArray(value?.projects) ? value.projects.map((p: any) => ({ id: String(p.id), name: String(p.name ?? p.slug ?? p.id) })) : [], kitRuns: Array.isArray(value?.runs) ? value.runs.map((r: any) => ({ id: String(r.id), status: String(r.status ?? "unknown") })) : [] }; }
export function buildCockpitViewModel(snapshot: FabForgeSnapshot): CockpitViewModel { return { navigation: ["projects", "components", "work-orders", "kit-runs", "evidence"], metrics: { projects: snapshot.projects.length, activeKitRuns: snapshot.kitRuns.filter((run) => !["complete", "cancelled"].includes(run.status)).length, blockedKitRuns: snapshot.kitRuns.filter((run) => run.status === "blocked").length } }; }
export function createFabForgeClient(input: { endpoint: string; token: string; workspaceId: string; fetchImpl?: FetchLike }) {
  const transport = { ...input, fetchImpl: input.fetchImpl ?? fetch };
  return { async snapshot() { const projects = payload(await get(transport, "/api/fabrication/v0/projects")); const runs = payload(await get(transport, "/api/fabrication/v0/kit-runs")); return normalizeFabForgeSnapshot({ projects, runs }); } };
}
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
