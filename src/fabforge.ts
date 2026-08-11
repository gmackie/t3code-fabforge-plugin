type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type FabForgeSnapshot = { projects: readonly { id: string; name: string }[]; kitRuns: readonly { id: string; status: string }[]; jobs?: readonly FabForgeJob[]; machines?: readonly FabForgeMachine[]; materials?: readonly FabForgeMaterial[]; artifacts?: readonly FabForgeArtifact[] };
export type FabForgeJob = { id: string; process: string; status: string; machineId?: string; material?: string };
export type FabForgeArtifact = { id: string; jobId: string; path: string; kind: "gcode" | "nc" | "svg" | "dxf" | "unknown"; status: "pending" | "passed" | "failed"; detail?: string };
export type FabForgeProcessControl = { action: "print" | "cut" | "mill" | "inspect"; artifactKinds: readonly ("gcode" | "nc" | "svg" | "dxf")[] };
export type FabForgeMachine = { id: string; name: string; process: string; status: string };
export type FabForgeMaterial = { id: string; name: string; process: string; stock: string };
export type FabForgeIdeSnapshot = FabForgeSnapshot & { jobs: readonly FabForgeJob[]; machines: readonly FabForgeMachine[]; materials: readonly FabForgeMaterial[] };
export type CockpitViewModel = { navigation: readonly string[]; metrics: { projects: number; activeKitRuns: number; blockedKitRuns: number } };
export type SurfaceCard =
  | { kind: "metric"; id: string; title: string; value: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }
  | { kind: "list"; id: string; title: string; items: readonly { id: string; title: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }[] };
export type SurfaceModel = { pluginId: string; navigationId: string; title: string; refreshedAt: string; cards: readonly SurfaceCard[] };
export type ManufacturingWorkflowModel = { readonly pluginId: string; readonly workflowId: string; readonly title: string; readonly currentStage: "inspect" | "context" | "propose" | "review" | "approve" | "execute" | "verify" | "respond"; readonly refreshedAt: string; readonly steps: readonly { id: string; stage: ManufacturingWorkflowModel["currentStage"]; title: string; state: "pending" | "active" | "completed" | "blocked" | "failed"; detail?: string }[]; readonly evidence?: readonly { id: string; title: string; kind: "check" | "artifact" | "diff" | "log" | "link"; status: "neutral" | "positive" | "warning" | "negative"; detail?: string }[]; readonly actions?: readonly { id: string; title: string; tone?: "primary" | "secondary" | "destructive" }[] };
export type FabForgeWorkflowState = { readonly approved?: boolean; readonly jobId?: string; readonly executionRequested?: boolean; readonly verificationStatus?: "pending" | "passed" | "failed" };

async function get(input: { endpoint: string; token: string; workspaceId: string; fetchImpl: FetchLike }, path: string): Promise<any> {
  const url = new URL(`${input.endpoint.replace(/\/$/, "")}${path}`); url.searchParams.set("workspaceId", input.workspaceId);
  const response = await input.fetchImpl(url, { headers: { authorization: `Bearer ${input.token}` } });
  if (!response.ok) throw new Error(`FabForge GET ${path} failed: ${response.status}`);
  return response.json();
}
async function post(input: { endpoint: string; token: string; workspaceId: string; fetchImpl: FetchLike }, path: string, body: unknown): Promise<any> {
  const url = new URL(`${input.endpoint.replace(/\/$/, "")}${path}`); url.searchParams.set("workspaceId", input.workspaceId);
  const response = await input.fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`FabForge POST ${path} failed: ${response.status}`);
  return response.json();
}
function payload(value: any): any { return value?.data ?? value; }
function artifactKind(value: unknown, path: string): FabForgeArtifact["kind"] { if (value === "gcode" || value === "nc" || value === "svg" || value === "dxf") return value; const extension = path.toLowerCase().split(".").pop(); return extension === "gcode" || extension === "nc" || extension === "svg" || extension === "dxf" ? extension : "unknown"; }
export function normalizeFabForgeSnapshot(value: any): FabForgeSnapshot { return { projects: Array.isArray(value?.projects) ? value.projects.map((p: any) => ({ id: String(p.id), name: String(p.name ?? p.slug ?? p.id) })) : [], kitRuns: Array.isArray(value?.runs) ? value.runs.map((r: any) => ({ id: String(r.id), status: String(r.status ?? "unknown") })) : [], ...(Array.isArray(value?.jobs) ? { jobs: value.jobs.map((job: any) => ({ id: String(job.id), process: String(job.process ?? "unknown"), status: String(job.status ?? "unknown"), ...(typeof job.machineId === "string" ? { machineId: job.machineId } : {}), ...(typeof job.material === "string" ? { material: job.material } : {}) })) } : {}), ...(Array.isArray(value?.machines) ? { machines: value.machines.map((machine: any) => ({ id: String(machine.id), name: String(machine.name ?? machine.id), process: String(machine.process ?? "unknown"), status: String(machine.status ?? "unknown") })) } : {}), ...(Array.isArray(value?.materials) ? { materials: value.materials.map((material: any) => ({ id: String(material.id), name: String(material.name ?? material.id), process: String(material.process ?? "unknown"), stock: String(material.stock ?? "unknown") })) } : {}), ...(Array.isArray(value?.artifacts) ? { artifacts: value.artifacts.map((artifact: any) => ({ id: String(artifact.id), jobId: String(artifact.jobId), path: String(artifact.path), kind: artifactKind(artifact.kind, String(artifact.path)), status: artifact.status === "passed" || artifact.status === "failed" ? artifact.status : "pending", ...(typeof artifact.detail === "string" ? { detail: artifact.detail } : {}) })) } : {}) }; }
export function buildProcessControl(job: FabForgeJob): FabForgeProcessControl {
  switch (job.process.toLowerCase()) {
    case "laser": return { action: "cut", artifactKinds: ["svg", "dxf"] };
    case "plasma": return { action: "cut", artifactKinds: ["dxf"] };
    case "cnc": return { action: "mill", artifactKinds: ["gcode", "nc"] };
    case "fdm":
    case "resin": return { action: "print", artifactKinds: ["gcode", "nc"] };
    default: return { action: "inspect", artifactKinds: [] };
  }
}
export function validateExecutionTarget(job: FabForgeJob, machine: FabForgeMachine): { ok: true } | { ok: false; reason: string } {
  if (machine.process.toLowerCase() !== job.process.toLowerCase()) return { ok: false, reason: `Machine ${machine.id} supports ${machine.process}, not ${job.process}` };
  if (!["online", "idle", "ready"].includes(machine.status.toLowerCase())) return { ok: false, reason: `Machine ${machine.id} is ${machine.status}` };
  return { ok: true };
}
export function buildManufacturingWorkflow(snapshot: FabForgeSnapshot, state: FabForgeWorkflowState = {}): ManufacturingWorkflowModel {
  const jobs = snapshot.jobs ?? [];
  const machines = snapshot.machines ?? [];
  const materials = snapshot.materials ?? [];
  const blocked = jobs.some((job) => ["blocked", "failed", "error"].includes(job.status));
  const steps = [
    { id: "inspect", stage: "inspect" as const, title: "Inspect manufacturing job", state: "completed" as const, detail: `${jobs.length} jobs in workspace` },
    { id: "context", stage: "context" as const, title: "Collect process, machine, and material context", state: "completed" as const, detail: `${machines.length} machines · ${materials.length} materials` },
    { id: "propose", stage: "propose" as const, title: "Propose fabrication plan", state: "completed" as const },
    { id: "review", stage: "review" as const, title: "Review fabrication plan", state: state.approved ? "completed" as const : "active" as const },
    { id: "approve", stage: "approve" as const, title: "Approve machine execution", state: state.approved ? "completed" as const : "pending" as const },
    { id: "execute", stage: "execute" as const, title: "Execute fabrication job", state: state.executionRequested ? "completed" as const : state.approved ? "active" as const : "pending" as const },
    { id: "verify", stage: "verify" as const, title: "Verify physical output", state: state.verificationStatus === "failed" ? "failed" as const : state.verificationStatus === "passed" ? "completed" as const : state.executionRequested ? "active" as const : "pending" as const, detail: state.verificationStatus === "passed" ? "Artifact verification passed" : state.verificationStatus === "failed" ? "Artifact verification failed" : blocked ? "Blocked job requires operator review" : "Awaiting execution evidence" },
    { id: "respond", stage: "respond" as const, title: "Prepare production response", state: "pending" as const },
  ];
  const firstJob = jobs.find((job) => job.id === state.jobId) ?? jobs[0];
  const control = firstJob ? buildProcessControl(firstJob) : undefined;
  const action = control?.action === "cut" ? "Cut" : control?.action === "mill" ? "Mill" : "Print";
  return { pluginId: "com.t3code.fabforge", workflowId: "fabforge.job-review", title: "Manufacturing job review", currentStage: state.executionRequested ? "verify" : state.approved ? "execute" : "review", refreshedAt: new Date().toISOString(), steps, evidence: [{ id: "manufacturing-readiness", title: "Manufacturing readiness", kind: "check", status: blocked ? "negative" : jobs.length > 0 ? "positive" : "warning", detail: `${jobs.length} jobs · ${machines.length} machines · ${materials.length} materials` }, ...(control ? [{ id: "process-control", title: `${firstJob?.process} process control`, kind: "artifact" as const, status: "neutral" as const, detail: `${action} · expected ${control.artifactKinds.join("/") || "operator evidence"}` }] : [])], actions: state.verificationStatus ? [] : state.executionRequested ? [{ id: "verify", title: "Verify fabrication artifact", tone: "primary" }] : state.approved ? [{ id: "execute", title: `${action} fabrication job`, tone: "primary" }] : [{ id: "approve", title: "Approve machine execution", tone: "primary" }] };
}
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
  return {
    async snapshot() { const projects = payload(await get(transport, "/api/fabrication/v0/projects")); const runs = payload(await get(transport, "/api/fabrication/v0/kit-runs")); const jobs = payload(await get(transport, "/api/fabrication/v0/jobs")); const machines = payload(await get(transport, "/api/fabrication/v0/machines")); const materials = payload(await get(transport, "/api/fabrication/v0/materials")); const artifacts = payload(await get(transport, "/api/fabrication/v0/artifacts")); return normalizeFabForgeSnapshot({ projects, runs, jobs, machines, materials, artifacts }); },
    async executeJob(input: { jobId: string; process: string; machineId?: string }) { return payload(await post(transport, `/api/fabrication/v0/jobs/${encodeURIComponent(input.jobId)}/execute`, { process: input.process, ...(input.machineId ? { machineId: input.machineId } : {}) })); },
    async verifyArtifact(input: { jobId: string; artifactPath: string; expectedKinds: readonly string[] }) { return payload(await post(transport, `/api/fabrication/v0/jobs/${encodeURIComponent(input.jobId)}/verify`, { artifactPath: input.artifactPath, expectedKinds: input.expectedKinds })); },
  };
}
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
