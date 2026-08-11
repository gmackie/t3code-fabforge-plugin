import { describe, expect, test } from "bun:test";
import { createRpcHandler } from "./rpc.ts";
import type { FabForgeWorkflowState } from "./fabforge.ts";

describe("FabForge RPC", () => {
  test("serves fabrication cards from the cached workspace snapshot", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [] }, refresh: async () => ({ projects: [], kitRuns: [] }) });
    await expect(handler("surface.get", { navigationId: "fabforge.kit-runs" })).resolves.toMatchObject({ ok: true, result: { pluginId: "com.t3code.fabforge", navigationId: "fabforge.kit-runs" } });
  });

  test("serves the station serial-console panel and action", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [{ id: "run-1", status: "running" }] }, refresh: async () => ({ projects: [], kitRuns: [] }) });
    await expect(handler("panel.get", { panelId: "fabforge.kit-runs" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "serial-console", connection: "connected" } } });
    await expect(handler("action.execute", { actionId: "fabforge.open-console" })).resolves.toMatchObject({ ok: true, result: { status: "completed" } });
  });

  test("serves the manufacturing job review workflow", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [], jobs: [], machines: [], materials: [] }, refresh: async () => ({ projects: [], kitRuns: [], jobs: [], machines: [], materials: [] }) });
    await expect(handler("workflow.get", { workflowId: "fabforge.job-review" })).resolves.toMatchObject({ ok: true, result: { workflowId: "fabforge.job-review" } });
  });

  test("serves job verification as a native T3 panel", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [], jobs: [{ id: "job-1", process: "fdm", status: "ready" }], machines: [], materials: [], artifacts: [{ id: "artifact-1", jobId: "job-1", path: "out/part.gcode", kind: "gcode", status: "pending" }] }, refresh: async () => ({ projects: [], kitRuns: [] }) });
    await expect(handler("panel.get", { panelId: "fabforge.job-verification" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "verification", status: "running", artifacts: [{ id: "artifact-1", status: "pending" }] } } });
  });

  test("requires approval before requesting machine execution", async () => {
    const calls: unknown[] = [];
    const handler = createRpcHandler({
      snapshot: { projects: [], kitRuns: [], jobs: [{ id: "job-1", process: "fdm", status: "ready", machineId: "printer-1" }], machines: [], materials: [] },
      refresh: async () => ({ projects: [], kitRuns: [] }),
      saveWorkflowState: async (state) => { calls.push(state); },
      executeJob: async (input) => { calls.push(input); return { status: "accepted" as const }; },
    });
    await expect(handler("action.execute", { actionId: "execute", workflowId: "fabforge.job-review", input: { jobId: "job-1" } })).resolves.toMatchObject({ ok: false });
    await expect(handler("action.execute", { actionId: "approve", workflowId: "fabforge.job-review" })).resolves.toMatchObject({ ok: true, result: { status: "approved" } });
    await expect(handler("action.execute", { actionId: "execute", workflowId: "fabforge.job-review", input: { jobId: "job-1", machineId: "printer-1" } })).resolves.toMatchObject({ ok: true, result: { status: "accepted" } });
    expect(calls).toEqual([{ approved: true }, { jobId: "job-1", process: "fdm", machineId: "printer-1" }, { approved: true, executionRequested: true }]);
  });

  test("persists the selected job when approving a manufacturing plan", async () => {
    let state: FabForgeWorkflowState = {};
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [], jobs: [{ id: "job-1", process: "fdm", status: "ready" }, { id: "job-2", process: "laser", status: "ready" }], machines: [], materials: [] }, refresh: async () => ({ projects: [], kitRuns: [] }), getWorkflowState: () => state, saveWorkflowState: async (next) => { state = next; } });
    await expect(handler("action.execute", { actionId: "approve", workflowId: "fabforge.job-review", input: { jobId: "job-2" } })).resolves.toMatchObject({ ok: true });
    expect(state).toEqual({ approved: true, jobId: "job-2" });
    await expect(handler("workflow.get", { workflowId: "fabforge.job-review" })).resolves.toMatchObject({ ok: true, result: { evidence: expect.arrayContaining([expect.objectContaining({ title: "laser process control" })]) } });
  });

  test("verifies an artifact and advances the workflow state", async () => {
    let state: FabForgeWorkflowState = { approved: true, executionRequested: true };
    const handler = createRpcHandler({
      snapshot: { projects: [], kitRuns: [], jobs: [{ id: "job-2", process: "laser", status: "running" }], machines: [], materials: [] },
      refresh: async () => ({ projects: [], kitRuns: [] }),
      getWorkflowState: () => state,
      saveWorkflowState: async (next) => { state = next; },
      verifyArtifact: async (input) => ({ status: "passed" as const, detail: `${input.artifactPath} verified` }),
    });
    await expect(handler("action.execute", { actionId: "verify", workflowId: "fabforge.job-review", input: { jobId: "job-2", artifactPath: "out/job-2.dxf" } })).resolves.toMatchObject({ ok: true, result: { status: "passed" } });
    expect(state).toEqual({ approved: true, executionRequested: true, verificationStatus: "passed" });
    await expect(handler("workflow.get", { workflowId: "fabforge.job-review" })).resolves.toMatchObject({ ok: true, result: { currentStage: "verify", steps: expect.arrayContaining([expect.objectContaining({ id: "verify", state: "completed" })]) } });
  });
});
