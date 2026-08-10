import { buildManufacturingWorkflow, buildSurfaceModel, type FabForgeSnapshot } from "./fabforge.ts";

export function createRpcHandler(coordinator: {
  snapshot: FabForgeSnapshot | null;
  refresh(): Promise<FabForgeSnapshot>;
}) {
  return async (method: string, payload?: { navigationId?: string; panelId?: string; actionId?: string; workflowId?: string; input?: unknown }) => {
    const snapshot = coordinator.snapshot ?? (await coordinator.refresh());
    if (method === "workflow.get") return { ok: true as const, result: buildManufacturingWorkflow(snapshot) };
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
    return { ok: false as const, error: `unsupported FabForge RPC method: ${method}` };
  };
}
