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

export class FabForgeApiError extends Error {
  // `uncertain`: the request may have reached FabForge (e.g. it timed out).
  constructor(readonly status: number, message: string, readonly uncertain = false) {
    super(message);
  }
}
export const FABFORGE_TIMEOUT_MS = 15_000;
type Transport = { endpoint: string; token: string; workspaceId: string; fetchImpl: FetchLike; timeoutMs: number };
// Every request is workspace-scoped and time-bounded. Errors stay short: no
// URLs, and no response bodies beyond FabForge's own one-line message on 4xx.
async function request(input: Transport, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const url = new URL(`${input.endpoint.replace(/\/$/, "")}${path}`); url.searchParams.set("workspaceId", input.workspaceId);
  let response: Response;
  try {
    response = await input.fetchImpl(url, { method, signal: AbortSignal.timeout(input.timeoutMs), headers: { accept: "application/json", authorization: `Bearer ${input.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new FabForgeApiError(0, `FabForge did not respond within ${Math.max(1, Math.ceil(input.timeoutMs / 1000))}s`, true);
    throw new FabForgeApiError(0, "Could not reach FabForge; check FABFORGE_URL and the network");
  }
  if (!response.ok) throw await apiError(response, input.workspaceId);
  const json = await response.json().catch(() => undefined);
  if (json === undefined) throw new FabForgeApiError(response.status, "FabForge returned an unexpected response");
  return json;
}
async function apiError(response: Response, workspaceId: string): Promise<FabForgeApiError> {
  const { status } = response;
  if (status >= 500) return new FabForgeApiError(status, "FabForge is temporarily unavailable");
  if (status === 401 || status === 403) return new FabForgeApiError(status, `FabForge rejected the token (${status}); check FABFORGE_TOKEN has access to workspace "${workspaceId}"`);
  if (status === 429) return new FabForgeApiError(status, "FabForge rate limit reached; try again shortly");
  const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  const message = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : undefined;
  if (status === 404) return new FabForgeApiError(status, `FabForge could not find that resource in workspace "${workspaceId}"${message ? `: ${message.slice(0, 200)}` : ""}`);
  return new FabForgeApiError(status, `FabForge request failed (${status})${message ? `: ${message.slice(0, 200)}` : ""}`);
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
export function createFabForgeClient(input: { endpoint: string; token: string; workspaceId: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
  const transport: Transport = { ...input, fetchImpl: input.fetchImpl ?? fetch, timeoutMs: input.timeoutMs ?? FABFORGE_TIMEOUT_MS };
  const get = (path: string) => request(transport, "GET", path).then(payload);
  return {
    async snapshot() { const [projects, runs, jobs, machines, materials, artifacts] = await Promise.all(["projects", "kit-runs", "jobs", "machines", "materials", "artifacts"].map((name) => get(`/api/fabrication/v0/${name}`))); return normalizeFabForgeSnapshot({ projects, runs, jobs, machines, materials, artifacts }); },
    async executeJob(input: { jobId: string; process: string; machineId?: string }) { return payload(await request(transport, "POST", `/api/fabrication/v0/jobs/${encodeURIComponent(input.jobId)}/execute`, { process: input.process, ...(input.machineId ? { machineId: input.machineId } : {}) })); },
    async verifyArtifact(input: { jobId: string; artifactPath: string; expectedKinds: readonly string[] }) { return payload(await request(transport, "POST", `/api/fabrication/v0/jobs/${encodeURIComponent(input.jobId)}/verify`, { artifactPath: input.artifactPath, expectedKinds: input.expectedKinds })); },
  };
}
export type FabForgeClient = ReturnType<typeof createFabForgeClient>;
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
export type JobVerificationSummary = { status: "idle" | "running" | "failed"; summary: string };
// The v1 job-verification panel's roll-up: any blocked job or failed artifact
// fails it, pending work keeps it running.
export function buildJobVerification(snapshot: FabForgeSnapshot): JobVerificationSummary {
  const jobs = snapshot.jobs ?? [];
  const artifacts = snapshot.artifacts ?? [];
  const blocked = jobs.some((job) => ["blocked", "failed", "error"].includes(job.status));
  const status = blocked || artifacts.some((artifact) => artifact.status === "failed") ? "failed" : jobs.length > 0 || artifacts.some((artifact) => artifact.status === "pending") ? "running" : "idle";
  return { status, summary: `${jobs.length} manufacturing jobs · ${snapshot.machines?.length ?? 0} machines · ${snapshot.materials?.length ?? 0} materials` };
}
// FabForge's verify endpoint answers with status and/or verification. Only an
// explicit pass counts as passed; anything unrecognised stays pending.
export function verificationOutcome(result: unknown): { status: "passed" | "failed" | "pending"; detail?: string } {
  const value = (result ?? {}) as { status?: unknown; verification?: unknown; detail?: unknown };
  const status = value.status === "failed" || value.verification === "failed" ? "failed" : value.status === "passed" || value.verification === "passed" ? "passed" : "pending";
  return { status, ...(typeof value.detail === "string" && value.detail ? { detail: value.detail.slice(0, 500) } : {}) };
}
// FabForge's execute endpoint answers with a status. Only an explicit
// accepted/queued/running/completed status with no error counts as sent;
// rejected, failed, missing or unknown statuses are errors.
const EXECUTION_STATUSES = ["accepted", "queued", "running", "completed"] as const;
export function executionOutcome(result: unknown): { ok: true; status: (typeof EXECUTION_STATUSES)[number]; reference?: string } | { ok: false; reason: string } {
  const value = (result && typeof result === "object" ? result : {}) as { status?: unknown; error?: unknown; message?: unknown; id?: unknown; reference?: unknown };
  const status = typeof value.status === "string" ? value.status.toLowerCase() : undefined;
  const error = typeof value.error === "string" && value.error ? value.error : value.error ? "error" : undefined;
  if (!error && status && (EXECUTION_STATUSES as readonly string[]).includes(status)) {
    const reference = typeof value.reference === "string" ? value.reference : typeof value.id === "string" ? value.id : undefined;
    return { ok: true, status: status as (typeof EXECUTION_STATUSES)[number], ...(reference ? { reference: reference.slice(0, 200) } : {}) };
  }
  const detail = error ?? (typeof value.message === "string" && value.message ? value.message : undefined);
  const label = status ? `status ${status.slice(0, 40)}` : "no status";
  return { ok: false, reason: `FabForge did not accept the job (${label})${detail ? `: ${detail.slice(0, 200)}` : ""}` };
}
