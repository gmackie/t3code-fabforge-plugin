import { buildManufacturingWorkflow, buildProcessControl, buildSurfaceModel, type FabForgeSnapshot, type FabForgeWorkflowState } from "./fabforge.ts";

export function createRpcHandler(coordinator: {
  snapshot: FabForgeSnapshot | null;
  refresh(): Promise<FabForgeSnapshot>;
  getWorkflowState?: () => FabForgeWorkflowState;
  saveWorkflowState?: (state: FabForgeWorkflowState) => Promise<void>;
  executeJob?: (input: { jobId: string; process: string; machineId?: string }) => Promise<{ status: "accepted" | "completed"; [key: string]: unknown }>;
  verifyArtifact?: (input: { jobId: string; artifactPath: string; expectedKinds: readonly string[] }) => Promise<{ status: "passed" | "failed"; detail?: string }>;
}) {
  let workflowState: FabForgeWorkflowState = {};
  const getState = () => coordinator.getWorkflowState?.() ?? workflowState;
  const saveState = async (state: FabForgeWorkflowState) => { workflowState = state; await coordinator.saveWorkflowState?.(state); };
  return async (method: string, payload?: { navigationId?: string; panelId?: string; actionId?: string; workflowId?: string; input?: unknown }) => {
    const snapshot = coordinator.snapshot ?? (await coordinator.refresh());
    if (method === "workflow.get") return { ok: true as const, result: buildManufacturingWorkflow(snapshot, getState()) };
    if (method === "surface.get") return { ok: true as const, result: buildSurfaceModel(snapshot, payload?.navigationId) };
    if (method === "panel.get" && payload?.panelId === "fabforge.kit-runs") {
      return {
        ok: true as const,
        result: {
          pluginId: "com.t3code.fabforge",
          panelId: "fabforge.kit-runs",
          title: "Kit-run station console",
          kind: "serial-console" as const,
          refreshedAt: new Date().toISOString(),
          content: {
            kind: "serial-console" as const,
            connection: "connected" as const,
            target: snapshot.kitRuns[0]?.id ?? "No active station",
            lines: snapshot.kitRuns.slice(0, 8).map((run) => ({ id: run.id, timestamp: new Date().toISOString(), stream: "system" as const, text: `kit run ${run.id}: ${run.status}` })),
            actions: [{ id: "fabforge.open-console", title: "Open console", tone: "primary" as const }],
          },
        },
      };
    }
    if (method === "panel.get" && payload?.panelId === "fabforge.job-verification") {
      const jobs = snapshot.jobs ?? [];
      const blocked = jobs.some((job) => ["blocked", "failed", "error"].includes(job.status));
      return {
        ok: true as const,
        result: {
          pluginId: "com.t3code.fabforge",
          panelId: "fabforge.job-verification",
          title: "Manufacturing job verification",
          kind: "verification" as const,
          refreshedAt: new Date().toISOString(),
          content: {
            kind: "verification" as const,
            status: blocked ? "failed" as const : jobs.length > 0 ? "running" as const : "idle" as const,
            summary: `${jobs.length} manufacturing jobs · ${snapshot.machines?.length ?? 0} machines · ${snapshot.materials?.length ?? 0} materials`,
            runs: jobs.slice(0, 8).map((job) => ({ id: job.id, title: `${job.process} job`, status: job.status, ...(job.machineId ? { detail: `machine ${job.machineId}` } : {}) })),
            actions: [{ id: "fabforge.refresh-verification", title: "Refresh verification" }],
          },
        },
      };
    }
    if (method === "action.execute" && payload?.actionId === "fabforge.open-console") return { ok: true as const, result: { status: "completed" as const, message: "Station console opened by FabForge." } };
    if (method === "action.execute" && payload?.workflowId === "fabforge.job-review") {
      const state = getState();
      if (payload.actionId === "approve") {
        await saveState({ ...state, approved: true });
        return { ok: true as const, result: { status: "approved" as const } };
      }
      const input = (payload.input ?? {}) as { jobId?: string; machineId?: string; artifactPath?: string };
      const job = (snapshot.jobs ?? []).find((candidate) => candidate.id === input.jobId) ?? snapshot.jobs?.[0];
      if (!job) return { ok: false as const, error: "FabForge has no manufacturing job to operate on" };
      if (payload.actionId === "execute") {
        if (!state.approved) return { ok: false as const, error: "Approve the manufacturing job before execution" };
        if (!coordinator.executeJob) return { ok: false as const, error: "FabForge execution callback is unavailable" };
        const result = await coordinator.executeJob({ jobId: job.id, process: job.process, ...(input.machineId ?? job.machineId ? { machineId: input.machineId ?? job.machineId } : {}) });
        await saveState({ ...state, approved: true, executionRequested: true });
        return { ok: true as const, result };
      }
      if (payload.actionId === "verify") {
        if (!state.executionRequested) return { ok: false as const, error: "Execute the manufacturing job before verification" };
        if (!coordinator.verifyArtifact) return { ok: false as const, error: "FabForge verification callback is unavailable" };
        if (!input.artifactPath) return { ok: false as const, error: "An artifact path is required for verification" };
        const result = await coordinator.verifyArtifact({ jobId: job.id, artifactPath: input.artifactPath, expectedKinds: buildProcessControl(job).artifactKinds });
        await saveState({ ...state, verificationStatus: result.status });
        return { ok: true as const, result };
      }
    }
    return { ok: false as const, error: `unsupported FabForge RPC method: ${method}` };
  };
}
